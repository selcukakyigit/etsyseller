"use client";

import { useEffect, useRef, useState } from "react";
import { api, ImageVersion, ListingImage, ListingVideo } from "@/lib/api";
import ImageCropper from "./ImageCropper";
import { Modal, btnGhost, btnPrimary } from "./Modal";
import { getRegenJob, runRegenJob, useRegenJobs } from "@/lib/regenJobs";
import RegenImage from "./RegenImage";
import CameraCube, { CameraAngle, cameraAnglePrompt } from "./CameraCube";
import DistancePicker, { Distance, distancePrompt } from "./DistancePicker";
import VersionDots from "./VersionDots";

const MAX_IMAGES = 20;
const MAX_VIDEOS = 2;

// Etsy'nin önerdiği ürün fotoğrafı çeşitliliği (kapak/açı/detay/ölçek/yaşam tarzı/uzak-yakın çekim). "Oluştur"
// modalinde bir adet ürün fotoğrafından, seçilen adette bu çeşitlilikte bir set otomatik üretilir.
const SHOT_PRESETS: { label: string; prompt: string }[] = [
  { label: "Ana fotoğraf (kapak)", prompt: "Ürünü düz, nötr/temiz bir arka planda, tam önden, merkezde, dengeli ve iyi aydınlatmayla, net odakla göster. Bu Etsy'de öne çıkan kapak fotoğrafı olacak." },
  { label: "Farklı açı (3/4)", prompt: "Aynı ürünü 3/4 açıdan (hafif yandan) göster; ışık ve arka plan tutarlı kalsın." },
  { label: "Yakın çekim / detay", prompt: "Ürünün dokusunu, malzemesini ve işçilik detayını çok yakından (makro çekim) göster." },
  { label: "Ölçek referansı", prompt: "Ürünü gerçek boyutunu anlaşılır kılmak için bir elin tuttuğu ya da yanında günlük bir eşyanın bulunduğu şekilde göster." },
  { label: "Yaşam tarzı (kullanımda)", prompt: "Ürünü gerçek kullanım ortamında, doğal bir yaşam tarzı sahnesinde, kullanılıyor/sergileniyor halde göster." },
  { label: "Uzak çekim / geniş kadraj", prompt: "Ürünü bulunduğu ortamla/mekânla birlikte geniş kadrajda, uzaktan göster." },
  { label: "Arka/üst görünüm", prompt: "Ürünün arka tarafını ya da üstten görünümünü göster." },
  { label: "Alternatif sahne", prompt: "Ürünü farklı bir zemin/dekor sahnesinde, ama aynı ürünle göster." },
];

const tile = "relative aspect-square overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800";
const addTile =
  "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-300 text-center text-neutral-600 transition hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500";
const iconBtn =
  "flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-sm shadow opacity-0 transition group-hover:opacity-100 focus:opacity-100 dark:bg-neutral-900/90";

// Henüz Etsy'ye yüklenmemiş taslak öğelerin id'si negatiftir (Etsy id'leri hep pozitif).
const draftId = () => -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
const isDraft = (id: number) => id < 0;
const withRanks = (list: ListingImage[]) => list.map((img, i) => ({ ...img, rank: i + 1 }));

/**
 * Fotoğraf ve video bölümü. Buradaki her işlem (ekleme, silme, sıralama, kırpma) yalnızca
 * yerel taslağı değiştirir; Etsy'ye "Yayınla" ile gider.
 */
export default function MediaManager({
  shopId,
  listingId,
  images,
  videos,
  onImagesChange,
  onVideosChange,
  onImageReplaced,
  title = "",
}: {
  shopId: number;
  listingId: number;
  images: ListingImage[];
  videos: ListingVideo[];
  onImagesChange: (images: ListingImage[]) => void;
  onVideosChange: (videos: ListingVideo[]) => void;
  /** Bir görsel kırpılıp yenisiyle değişince eski id'ye bağlı yerleri (varyasyon fotoğrafları) taşımak için. */
  onImageReplaced: (oldId: number, newId: number) => void;
  /** Alt metin üretirken bağlam olarak kullanılan listing başlığı. */
  title?: string;
}) {
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const genFileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [cropIdx, setCropIdx] = useState<number | null>(null);
  const [altIdx, setAltIdx] = useState<number | null>(null);
  const [altText, setAltText] = useState("");
  const [altBusy, setAltBusy] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);
  const [viewIdx, setViewIdx] = useState<number | null>(null); // büyük önizleme + AI düzenleme kutusu
  const [viewPrompt, setViewPrompt] = useState("");
  const [viewCameraAngle, setViewCameraAngle] = useState<CameraAngle | null>(null);
  const [viewDistance, setViewDistance] = useState<Distance | null>(null);
  // Sahnede birden fazla obje olduğunda "ürün bu" diye işaret eden referans fotoğrafı (listing'in kendi fotoğraflarından biri).
  const [viewSubjectId, setViewSubjectId] = useState<number | null>(null);
  const [versionsTick, setVersionsTick] = useState(0); // sürüm noktalarını tazelemek için (yeni sürüm üretilince)
  const [videoView, setVideoView] = useState<ListingVideo | null>(null); // videoyu modalda oynat
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [genOpen, setGenOpen] = useState(false); // "Oluştur" — sıfırdan (ya da bir referanstan) yeni görsel seti
  const [genPrompt, setGenPrompt] = useState("");
  const [genRefFile, setGenRefFile] = useState<File | null>(null);
  const [genKeepRef, setGenKeepRef] = useState(true);
  const [genQty, setGenQty] = useState(5);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genShots, setGenShots] = useState<
    { label: string; prompt: string; status: "pending" | "running" | "done" | "error"; error?: string }[]
  >([]);

  const ordered = [...images].sort((a, b) => a.rank - b.rank);
  const primary = ordered[0];

  // Eşzamanlı yarış durumunu önlemek için (tek seferde tek görsel değişsin): en güncel diziyi
  // async bir işin tamamlanma anında okumak üzere ref'te tutulur.
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;

  // "Oluştur" modali açıkken Ctrl+V ile resim yapıştırma desteği.
  useEffect(() => {
    if (!genOpen) return;
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((it) => it.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) setGenRefFile(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [genOpen]);

  const regenJobs = useRegenJobs();
  const [bulkRegen, setBulkRegen] = useState(false);
  const anyRegenBusy = bulkRegen || ordered.some((img) => regenJobs.get(img.listing_image_id)?.phase === "running");

  const fileUrl = (fileId: string) => api.listings.draftFileUrl(shopId, listingId, fileId);
  const imageEntry = (fileId: string, altText: string | null): ListingImage => ({
    listing_image_id: draftId(),
    draft_file_id: fileId,
    rank: 0,
    url_170x135: fileUrl(fileId),
    url_570xN: fileUrl(fileId),
    url_fullxfull: fileUrl(fileId),
    alt_text: altText,
  });

  // Alt metin: Etsy API'si yalnızca fotoğraf YÜKLENİRKEN alt metin kabul eder; bu yüzden yalnızca yeni (taslak) fotoğraflar düzenlenebilir.
  const missingAlt = ordered.filter((i) => isDraft(i.listing_image_id) && i.draft_file_id && !i.alt_text);

  async function generateAlts(fileIds: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (let i = 0; i < fileIds.length; i += 10) {
      Object.assign(out, (await api.listings.generateAltText(shopId, listingId, fileIds.slice(i, i + 10), title)).alt_texts);
    }
    return out;
  }

  async function fillMissingAlts() {
    setError(null);
    setBusy(`Alt metinler yazılıyor (${missingAlt.length})…`);
    try {
      const texts = await generateAlts(missingAlt.map((i) => i.draft_file_id as string));
      onImagesChange(ordered.map((img) => (img.draft_file_id && texts[img.draft_file_id] ? { ...img, alt_text: texts[img.draft_file_id] } : img)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Alt metinler yazılamadı");
    } finally {
      setBusy(null);
    }
  }

  function openAlt(i: number) {
    setAltIdx(i);
    setAltText(ordered[i]?.alt_text ?? "");
    setAltError(null);
  }

  async function aiForOpenAlt() {
    const img = altIdx !== null ? ordered[altIdx] : null;
    if (!img?.draft_file_id) return;
    setAltBusy(true);
    setAltError(null);
    try {
      const texts = await generateAlts([img.draft_file_id]);
      setAltText(texts[img.draft_file_id] ?? "");
    } catch (e) {
      setAltError(e instanceof Error ? e.message : "Alt metin yazılamadı");
    } finally {
      setAltBusy(false);
    }
  }

  function saveAlt() {
    if (altIdx === null) return;
    onImagesChange(ordered.map((img, i) => (i === altIdx ? { ...img, alt_text: altText.trim() || null } : img)));
    setAltIdx(null);
  }

  // Kırpma aracının görseli alacağı adres: taslak dosyası ya da (CORS için) backend üzerinden Etsy görseli.
  const cropSource = (img: ListingImage) =>
    img.draft_file_id ? fileUrl(img.draft_file_id) : api.listings.imageFileUrl(shopId, listingId, img.listing_image_id);

  async function addPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_IMAGES - ordered.length);
    if (files.length === 0) return;
    setError(null);
    let current = ordered;
    try {
      for (let i = 0; i < files.length; i++) {
        setBusy(`Fotoğraf ekleniyor (${i + 1}/${files.length})…`);
        const up = await api.listings.uploadDraftFile(shopId, listingId, files[i], "image", files[i].name);
        current = [...current, imageEntry(up.file_id, null)];
        onImagesChange(withRanks(current));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setBusy(null);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  async function addVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy("Video ekleniyor…");
    try {
      const up = await api.listings.uploadDraftFile(shopId, listingId, file, "video", file.name);
      onVideosChange([
        ...videos,
        {
          video_id: draftId(),
          draft_file_id: up.file_id,
          height: 0,
          width: 0,
          thumbnail_url: "",
          video_url: fileUrl(up.file_id),
          video_state: "draft",
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setBusy(null);
      if (videoInput.current) videoInput.current.value = "";
    }
  }

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onImagesChange(withRanks(next));
  }

  async function applyCrop(blob: Blob) {
    if (cropIdx === null) return;
    const old = ordered[cropIdx];
    setCropIdx(null);
    setError(null);
    setBusy("Kırpılan görsel taslağa ekleniyor…");
    try {
      const up = await api.listings.uploadDraftFile(shopId, listingId, blob, "image", "kirpilmis.jpg");
      const entry = imageEntry(up.file_id, old.alt_text);
      const next = ordered.map((img, i) => (i === cropIdx ? entry : img));
      onImagesChange(withRanks(next));
      onImageReplaced(old.listing_image_id, entry.listing_image_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setBusy(null);
    }
  }

  // Sihirli değnek: ürünü koruyup sahneyi doğallaştıran AI yeniden oluşturma. Tekli ve toplu buton
  // birebir aynı bu fonksiyonu çağırır — toplu, seçili görselleri sırayla (aynı anda tek iş) işler.
  // Döner: başarılıysa yeni taslak dosyasının id'si (toplu üretimde bir sonraki görsele "aynı modeli
  // koru" referansı olarak verilir), başarısızsa null.
  async function regenerateOne(
    img: ListingImage,
    opts?: {
      prompt?: string;
      referenceFileId?: string;
      cameraPrompt?: string;
      distancePrompt?: string;
      subjectImageId?: number;
      subjectDraftFileId?: string;
    }
  ): Promise<string | null> {
    const key = img.listing_image_id;
    const up = await runRegenJob(key, () =>
      api.listings.regenerateImage(shopId, listingId, img.listing_image_id, img.draft_file_id ?? null, {
        prompt: opts?.prompt,
        referenceDraftFileId: opts?.referenceFileId,
        cameraPrompt: opts?.cameraPrompt,
        distancePrompt: opts?.distancePrompt,
        subjectImageId: opts?.subjectImageId,
        subjectDraftFileId: opts?.subjectDraftFileId,
      })
    );
    if (!up) return null; // hata zaten kutucuk üstünde gösteriliyor, ya da iş zaten sürüyor
    const entry = imageEntry(up.file_id, img.alt_text);
    const next = orderedRef.current.map((x) => (x.listing_image_id === img.listing_image_id ? entry : x));
    onImagesChange(withRanks(next));
    onImageReplaced(img.listing_image_id, entry.listing_image_id);
    setVersionsTick((t) => t + 1);
    return up.file_id;
  }

  // Sürüm noktalarından birine tıklayınca: o sürümü (orijinal Etsy fotoğrafı ya da üretilmiş bir AI sürümü)
  // görüntülenen fotoğraf olarak geri getirir. Hiçbir dosya silinmediği için bu tamamen geri alınabilir.
  function selectVersion(idx: number, version: ImageVersion) {
    const old = ordered[idx];
    const entry: ListingImage = version.file_id
      ? imageEntry(version.file_id, old.alt_text)
      : {
          listing_image_id: version.listing_image_id as number,
          draft_file_id: undefined,
          url_170x135: version.url_170x135 as string,
          url_570xN: version.url_570xN as string,
          url_fullxfull: version.url_fullxfull,
          alt_text: version.alt_text ?? old.alt_text,
          rank: old.rank,
        };
    const next = ordered.map((x, i) => (i === idx ? entry : x));
    onImagesChange(withRanks(next));
    onImageReplaced(old.listing_image_id, entry.listing_image_id);
    setVersionsTick((t) => t + 1);
  }

  // Her seçili fotoğrafa Etsy'nin önerdiği çekim çeşitliliğinden (bkz. SHOT_PRESETS — kapak/açı/detay/
  // ölçek/yaşam tarzı/uzak-yakın) FARKLI bir preset sırayla atanır (round-robin). Önceki hâlde her fotoğrafa
  // aynı "yaşam tarzı + aynı model" talimatı gidiyordu — model her seferinde neredeyse aynı kişiyi aynı
  // pozda üretti (gözlemlendi: 3 farklı odada aynı kadın, aynı poz). Artık her fotoğraf bağımsız, farklı bir
  // çekim türü istiyor, bu yüzden aralarında paylaşılan bir referans/sıra bağımlılığı da yok — hepsi paralel
  // işlenebiliyor (Gemini kotasını tek seferde boğmamak için CONCURRENCY ile sınırlı).
  const BATCH_CONCURRENCY = 3;

  async function regenerateBatch(targets: ListingImage[]) {
    if (targets.length === 0) return;
    setBulkRegen(true);
    setError(null);
    try {
      let cursor = 0;
      let firstError: string | null = null;
      async function worker() {
        while (cursor < targets.length) {
          const i = cursor++;
          const img = targets[i];
          const preset = SHOT_PRESETS[i % SHOT_PRESETS.length];
          const fileId = await regenerateOne(img, { prompt: preset.prompt });
          if (!fileId && !firstError) {
            const jobErr = getRegenJob(img.listing_image_id)?.error;
            firstError = `Toplu üretimde bir fotoğraf başarısız oldu${jobErr ? `: ${jobErr}` : ""}.`;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, targets.length) }, worker));
      if (firstError) setError(firstError);
    } finally {
      setBulkRegen(false);
    }
  }

  async function regenerateAll() {
    await regenerateBatch(orderedRef.current);
  }

  async function regenerateSelected() {
    const targets = orderedRef.current.filter((img) => selected.has(img.listing_image_id));
    await regenerateBatch(targets);
    setSelected(new Set());
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // "Oluştur": bir (opsiyonel) ürün fotoğrafından, Etsy'nin önerdiği çeşitlilikte (kapak/açı/detay/ölçek/
  // yaşam tarzı/uzak-yakın çekim) seçilen adette fotoğraf üretir; her biri bitince listeye tek tek eklenir.
  // Referans fotoğraf yoksa yalnızca yazılan genel talimattan (sahne hayal ederek) üretir.
  async function generateShoot() {
    const remaining = MAX_IMAGES - orderedRef.current.length;
    const qty = Math.max(1, Math.min(genQty, remaining));
    setGenBusy(true);
    setGenError(null);
    try {
      let referenceFileId: string | undefined;
      if (genRefFile) {
        const up = await api.listings.uploadDraftFile(shopId, listingId, genRefFile, "image", genRefFile.name);
        referenceFileId = up.file_id;
        if (genKeepRef) {
          onImagesChange(withRanks([...orderedRef.current, imageEntry(up.file_id, null)]));
        }
      }
      const note = genPrompt.trim() ? ` Ek not: ${genPrompt.trim()}` : "";
      const shots = Array.from({ length: qty }, (_, i) => {
        const preset = SHOT_PRESETS[i % SHOT_PRESETS.length];
        const cycle = Math.floor(i / SHOT_PRESETS.length);
        const label = cycle > 0 ? `${preset.label} (${cycle + 1})` : preset.label;
        const prompt = preset.prompt + note + (cycle > 0 ? " Önceki üretilenlerden belirgin şekilde farklı bir varyasyon olsun." : "");
        return { label, prompt, status: "pending" as const };
      });
      setGenShots(shots);
      for (let i = 0; i < shots.length; i++) {
        setGenShots((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: "running" } : s)));
        try {
          const up = await api.listings.generateImage(shopId, listingId, shots[i].prompt, referenceFileId);
          onImagesChange(withRanks([...orderedRef.current, imageEntry(up.file_id, null)]));
          setGenShots((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: "done" } : s)));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Üretilemedi";
          setGenShots((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: "error", error: msg } : s)));
          break; // ilk hatada dur (ör. kota dolu), kalan çekimleri boşuna deneme
        }
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Görsel üretilemedi");
    } finally {
      setGenBusy(false);
    }
  }

  function closeGen() {
    setGenOpen(false);
    setGenPrompt("");
    setGenRefFile(null);
    setGenShots([]);
    setGenError(null);
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Fotoğraf ve video</h2>
      <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
        En fazla {MAX_IMAGES} fotoğraf ve {MAX_VIDEOS} video. İlk fotoğraf öne çıkan olur ve küçük resim olarak kullanılır;
        sıralamak için sürükle. Değişiklikler taslağa kaydedilir, Etsy&apos;ye &quot;Yayınla&quot; ile gider.
      </p>

      {ordered.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
          <span>
            Alt metin: {ordered.filter((i) => !!i.alt_text).length}/{ordered.length} fotoğrafta var. Etsy, mevcut fotoğrafların alt metnini değiştirmeye izin vermez; yalnızca yeni yüklenen ya da kırpılan fotoğraflarda yazılabilir.
          </span>
          <div className="flex flex-wrap gap-2">
            {missingAlt.length > 0 && (
              <button type="button" onClick={() => void fillMissingAlts()} disabled={!!busy} className="rounded-full border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950">
                ✨ Eksik alt metinleri yapay zekâyla yaz ({missingAlt.length})
              </button>
            )}
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Set())} className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                Seçimi temizle
              </button>
            )}
            <button
              type="button"
              onClick={() => void (selected.size > 0 ? regenerateSelected() : regenerateAll())}
              disabled={anyRegenBusy}
              title={selected.size > 0 ? "Yalnızca seçili fotoğrafları yapay zekâyla yeniden oluşturur" : "Tüm fotoğrafları, ürünü koruyarak yapay zekâyla tek tek yeniden oluşturur"}
              className="rounded-full border border-[#F1641E] px-3 py-1.5 text-xs font-semibold text-[#F1641E] hover:bg-orange-50 disabled:opacity-50 dark:hover:bg-orange-950"
            >
              {bulkRegen
                ? "🪄 Yeniden oluşturuluyor…"
                : selected.size > 0
                  ? `🪄 Seçilenleri yeniden oluştur (${selected.size})`
                  : `🪄 Tüm fotoğrafları yeniden oluştur (${ordered.length})`}
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {ordered.map((img, i) => (
          <div
            key={img.listing_image_id}
            draggable={!busy}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx !== null) move(dragIdx, i);
              setDragIdx(null);
            }}
            className={`${tile} group cursor-grab ${selected.has(img.listing_image_id) ? "ring-2 ring-[#F1641E]" : ""}`}
          >
            <RegenImage
              src={img.url_570xN}
              alt={img.alt_text ?? ""}
              draggable={false}
              onClick={() => {
                setViewIdx(i);
                setViewPrompt("");
              }}
              className="h-full w-full cursor-zoom-in object-cover"
              jobKey={img.listing_image_id}
              job={regenJobs.get(img.listing_image_id)}
            />
            <label
              className="absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow dark:bg-neutral-900/90"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              draggable={false}
            >
              <input
                type="checkbox"
                checked={selected.has(img.listing_image_id)}
                onChange={() => toggleSelected(img.listing_image_id)}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Fotoğrafı seç"
                className="h-3.5 w-3.5"
              />
            </label>
            {i === 0 && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-800">
                Öne çıkan
              </span>
            )}
            {isDraft(img.listing_image_id) && (
              <span className="absolute left-7 top-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                Yeni
              </span>
            )}
            <div className="absolute bottom-1.5 left-1.5 flex gap-1.5">
              <button
                onClick={() => onImagesChange(withRanks(ordered.filter((x) => x.listing_image_id !== img.listing_image_id)))}
                aria-label="Fotoğrafı sil"
                title="Sil"
                className={iconBtn}
              >
                🗑
              </button>
              <button onClick={() => setCropIdx(i)} aria-label="Fotoğrafı kırp" title="Kırp" className={iconBtn}>
                ✂
              </button>
              <button
                onClick={() => void regenerateOne(img)}
                disabled={anyRegenBusy}
                aria-label="Yapay zekâyla yeniden oluştur"
                title="Sihirli değnek: yapay zekâyla yeniden oluştur"
                className={`${iconBtn} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                🪄
              </button>
            </div>
            <button
              type="button"
              onClick={() => openAlt(i)}
              title={img.alt_text ? `Alt metin: ${img.alt_text}` : "Alt metin ekle"}
              className={`absolute bottom-1.5 right-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow ${img.alt_text ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
            >
              ALT{img.alt_text ? " ✓" : ""}
            </button>
          </div>
        ))}

        {videos.map((video) => (
          <div key={video.video_id} onClick={() => setVideoView(video)} className={`${tile} group cursor-pointer`}>
            {video.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <video src={video.video_url} muted preload="metadata" className="h-full w-full object-cover" />
            )}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow">
                {/* Unicode ▶ karakteri bazı tarayıcı/font kombinasyonlarında emoji olarak render olup
                    kayboluyordu (gözlemlendi) — SVG her yerde aynı, garantili görünür. */}
                <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-neutral-900">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
            {isDraft(video.video_id) && (
              <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                Yeni
              </span>
            )}
            <div className="absolute bottom-1.5 left-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onVideosChange(videos.filter((v) => v.video_id !== video.video_id));
                }}
                aria-label="Videoyu sil"
                title="Sil"
                className={iconBtn}
              >
                🗑
              </button>
            </div>
          </div>
        ))}

        {videos.length < MAX_VIDEOS && (
          <label className={addTile}>
            <span className="text-2xl">🎬</span>
            <span className="text-sm font-semibold">Video ekle</span>
            <span className="text-xs text-neutral-400">{MAX_VIDEOS - videos.length} hakkın kaldı</span>
            <input ref={videoInput} type="file" accept="video/*" className="hidden" onChange={addVideo} disabled={!!busy} />
          </label>
        )}

        {ordered.length < MAX_IMAGES && (
          <label className={addTile}>
            <span className="text-2xl">🖼</span>
            <span className="text-sm font-semibold">Fotoğraf ekle</span>
            <span className="text-xs text-neutral-400">{MAX_IMAGES - ordered.length} hakkın kaldı</span>
            <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} disabled={!!busy} />
          </label>
        )}

        {ordered.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => {
              setGenQty(Math.min(5, MAX_IMAGES - ordered.length));
              setGenOpen(true);
            }}
            className={addTile}
          >
            <span className="text-2xl">🎨</span>
            <span className="text-sm font-semibold">Oluştur</span>
            <span className="text-xs text-neutral-400">Sıfırdan görsel üret</span>
          </button>
        )}
      </div>

      {busy && <p className="mt-3 text-sm text-neutral-500">{busy}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {primary && (
        <div className="mt-6 border-t border-neutral-100 pt-5 dark:border-neutral-800">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-md">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Küçük resimler</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Küçük resimler, öne çıkan fotoğrafının Etsy&apos;de görünen kırpılmış hâlidir. Konunun net ve ortada olması için
                öne çıkan fotoğrafı kırp.
              </p>
            </div>
            <button
              onClick={() => setCropIdx(0)}
              className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              ⤢ Küçük resmi kırp
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {[
              { label: "Kare", cls: "aspect-square w-32" },
              { label: "Dikey", cls: "aspect-[3/4] w-28" },
              { label: "Yatay", cls: "aspect-[4/3] w-40" },
            ].map((t) => (
              <figure key={t.label}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={primary.url_570xN}
                  alt=""
                  className={`${t.cls} rounded-lg border border-neutral-200 object-cover dark:border-neutral-800`}
                />
                <figcaption className="mt-1 text-center text-xs text-neutral-500">{t.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      {altIdx !== null && ordered[altIdx] && (
        <Modal
          z={120}
          widthClass="max-w-lg"
          title="Fotoğraf alt metni"
          footer={
            <>
              <button type="button" onClick={() => setAltIdx(null)} className={btnGhost}>
                {isDraft(ordered[altIdx].listing_image_id) ? "Vazgeç" : "Kapat"}
              </button>
              {isDraft(ordered[altIdx].listing_image_id) && (
                <button type="button" onClick={saveAlt} className={btnPrimary}>
                  Kaydet
                </button>
              )}
            </>
          }
        >
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ordered[altIdx].url_170x135} alt="" className="h-24 w-24 flex-shrink-0 rounded-lg object-cover" />
            <p className="text-xs text-neutral-500">Ekran okuyucular ve aramalar için fotoğrafta görünenin kısa tarifi. Önerilen en fazla 125 karakter, en çok 500.</p>
          </div>
          <textarea
            value={altText}
            onChange={(e) => setAltText(e.target.value.slice(0, 500))}
            readOnly={!isDraft(ordered[altIdx].listing_image_id)}
            rows={3}
            placeholder="Örn. Siyah metal dağ silüeti, açık gri duvarda"
            className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className={altText.length > 125 ? "text-amber-600" : "text-neutral-400"}>{altText.length}/125 önerilen</span>
            {isDraft(ordered[altIdx].listing_image_id) && ordered[altIdx].draft_file_id && (
              <button type="button" onClick={() => void aiForOpenAlt()} disabled={altBusy} className="font-semibold text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400">
                {altBusy ? "Yazılıyor…" : "✨ Yapay zekâyla yaz"}
              </button>
            )}
          </div>
          {!isDraft(ordered[altIdx].listing_image_id) && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Bu fotoğraf Etsy&apos;de zaten yüklü ve Etsy API&apos;si mevcut fotoğrafın alt metnini değiştirmeye izin vermiyor. Alt metin yazmak için fotoğrafı kırparak (✂) yeni bir kopya olarak yeniden ekleyebilirsin.
            </p>
          )}
          {altError && <p className="mt-2 text-xs text-red-600">{altError}</p>}
        </Modal>
      )}

      {cropIdx !== null && ordered[cropIdx] && (
        <ImageCropper src={cropSource(ordered[cropIdx])} onCancel={() => setCropIdx(null)} onApply={applyCrop} />
      )}

      {videoView && (
        <Modal z={120} widthClass="max-w-2xl" title="Video" onClose={() => setVideoView(null)}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={videoView.video_url} controls autoPlay className="max-h-[70vh] w-full rounded-lg bg-black" />
        </Modal>
      )}

      {viewIdx !== null && ordered[viewIdx] && (
        <Modal z={120} widthClass="max-w-2xl" title={`Fotoğraf ${viewIdx + 1}/${ordered.length}`} onClose={() => setViewIdx(null)}>
          <div className="relative">
            <RegenImage
              src={ordered[viewIdx].url_570xN}
              alt=""
              wrapperClassName="w-full"
              className="max-h-[55vh] w-full rounded-lg object-contain"
              jobKey={ordered[viewIdx].listing_image_id}
              job={regenJobs.get(ordered[viewIdx].listing_image_id)}
            />
            <VersionDots
              shopId={shopId}
              listingId={listingId}
              img={ordered[viewIdx]}
              refreshToken={versionsTick}
              onSelect={(v) => selectVersion(viewIdx, v)}
            />
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => { setViewIdx((viewIdx - 1 + ordered.length) % ordered.length); setViewPrompt(""); setViewCameraAngle(null); setViewDistance(null); setViewSubjectId(null); }}
              disabled={ordered.length < 2}
              className={`${btnGhost} disabled:opacity-40`}
            >
              ‹ Önceki
            </button>
            <button
              type="button"
              onClick={() => { setViewIdx((viewIdx + 1) % ordered.length); setViewPrompt(""); setViewCameraAngle(null); setViewDistance(null); setViewSubjectId(null); }}
              disabled={ordered.length < 2}
              className={`${btnGhost} disabled:opacity-40`}
            >
              Sonraki ›
            </button>
            <button type="button" onClick={() => setCropIdx(viewIdx)} className={btnGhost}>
              ✂️ Kırp
            </button>
          </div>
          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800 space-y-3">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
              <div className="flex gap-4">
                <div className="flex-1">
                  <CameraCube value={viewCameraAngle} onChange={setViewCameraAngle} />
                </div>
                <div className="w-28 shrink-0 border-l border-neutral-200 pl-3 dark:border-neutral-800">
                  <DistancePicker value={viewDistance} onChange={setViewDistance} vertical />
                </div>
              </div>
            </div>
            {ordered.length > 1 && (
              <details className="group rounded-lg border border-neutral-200 dark:border-neutral-800">
                <summary className="flex cursor-pointer list-none items-center justify-between p-3 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  <span>
                    🎯 Ürün referansı (opsiyonel){viewSubjectId !== null && <span className="ml-2 font-normal text-[#F1641E]">seçili</span>}
                  </span>
                  <span className="text-neutral-400 transition group-open:rotate-180">▾</span>
                </summary>
                <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
                  <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
                    Sahnede birden fazla obje olduğunda ya da ürün net seçilemediğinde, hangisinin ürün olduğunu göstermek için
                    temiz bir ürün fotoğrafı seç.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setViewSubjectId(null)}
                      className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                        viewSubjectId === null
                          ? "border-[#F1641E] text-[#F1641E]"
                          : "border-neutral-300 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400"
                      }`}
                    >
                      Yok
                    </button>
                    {ordered
                      .filter((_, i) => i !== viewIdx)
                      .map((img) => (
                        <button
                          key={img.listing_image_id}
                          type="button"
                          onClick={() => setViewSubjectId(viewSubjectId === img.listing_image_id ? null : img.listing_image_id)}
                          className={`overflow-hidden rounded-lg border-2 ${
                            viewSubjectId === img.listing_image_id ? "border-[#F1641E]" : "border-transparent"
                          }`}
                          title="Ürün referansı olarak seç"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url_170x135} alt="" className="h-12 w-12 object-cover" />
                        </button>
                      ))}
                  </div>
                </div>
              </details>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">🪄 Yapay zekâyla düzenle</p>
              <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
                Ne değişsin? Ör. &quot;modelin elinde tutsun&quot;, &quot;oturma odasında göster&quot;, &quot;arka planı beyaz yap&quot;.
                Boş bırakırsan yalnızca doğal/stüdyo kalitesine getirir; belirtmediğin kısımlar (ürünün kendisi) değişmez.
              </p>
              <textarea
                value={viewPrompt}
                onChange={(e) => setViewPrompt(e.target.value.slice(0, 2000))}
                rows={2}
                placeholder="Örn. Bu ürünü bir kişi elinde tutuyor gibi göster"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const subject = viewSubjectId !== null ? ordered.find((x) => x.listing_image_id === viewSubjectId) : undefined;
                  void regenerateOne(ordered[viewIdx], {
                    prompt: viewPrompt || undefined,
                    cameraPrompt: viewCameraAngle ? cameraAnglePrompt(viewCameraAngle) : undefined,
                    distancePrompt: viewDistance ? distancePrompt(viewDistance) : undefined,
                    subjectImageId: subject?.listing_image_id,
                    subjectDraftFileId: subject?.draft_file_id,
                  });
                }}
                disabled={regenJobs.get(ordered[viewIdx].listing_image_id)?.phase === "running"}
                className="rounded-full bg-[#F1641E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d9550f] disabled:opacity-50"
              >
                {regenJobs.get(ordered[viewIdx].listing_image_id)?.phase === "running" ? "Oluşturuluyor…" : "🪄 Yeniden oluştur"}
              </button>
              {regenJobs.get(ordered[viewIdx].listing_image_id)?.phase === "error" && (
                <span className="text-xs text-red-600">{regenJobs.get(ordered[viewIdx].listing_image_id)?.error}</span>
              )}
            </div>
          </div>
        </Modal>
      )}

      {genOpen && (
        <Modal z={120} widthClass="max-w-lg" title="Fotoğraf seti oluştur" onClose={genBusy ? undefined : closeGen} footer={
          <>
            <button type="button" onClick={closeGen} disabled={genBusy} className={`${btnGhost} disabled:opacity-40`}>
              {genShots.length > 0 ? "Bitir" : "Vazgeç"}
            </button>
            {genShots.length === 0 && (
              <button type="button" onClick={() => void generateShoot()} disabled={genBusy} className={btnPrimary}>
                {genBusy ? "Oluşturuluyor…" : `${genQty} fotoğraf oluştur`}
              </button>
            )}
          </>
        }>
          {genShots.length === 0 ? (
            <>
              <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
                Bir ürün fotoğrafı ver — Etsy&apos;nin önerdiği çeşitlilikte (kapak, farklı açı, yakın çekim/detay,
                ölçek referansı, yaşam tarzı, uzak/geniş kadraj…) bir fotoğraf seti otomatik üretilir, her biri
                bitikçe listeye eklenir. Fotoğraf vermezsen yalnızca yazdığın tarife göre (hayal ederek) üretir.
              </p>

              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Ürün fotoğrafı (opsiyonel ama önerilir)
              </label>
              <div
                onClick={() => genFileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
                  if (file) setGenRefFile(file);
                }}
                className="mb-3 flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-neutral-300 p-3 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500"
              >
                {genRefFile ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={URL.createObjectURL(genRefFile)} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xl dark:bg-neutral-800">🖼</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    {genRefFile ? genRefFile.name : "Tıkla, sürükle-bırak ya da yapıştır (Ctrl+V)"}
                  </p>
                  {genRefFile && (
                    <label className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={genKeepRef} onChange={(e) => setGenKeepRef(e.target.checked)} />
                      Bu gerçek fotoğrafı da listeye ekle
                    </label>
                  )}
                </div>
                <input
                  ref={genFileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setGenRefFile(e.target.files?.[0] ?? null)}
                />
              </div>

              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Kaç fotoğraf üretilsin?</label>
              <input
                type="number"
                min={1}
                max={MAX_IMAGES - ordered.length}
                value={genQty}
                onChange={(e) => setGenQty(Math.max(1, Math.min(MAX_IMAGES - ordered.length, Number(e.target.value) || 1)))}
                className="mb-3 w-24 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
              <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
                {MAX_IMAGES - ordered.length} fotoğraf hakkın kaldı. 8&apos;den fazlasında çekim türleri tekrar edip varyasyon üretilir.
              </p>

              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Ek not (opsiyonel)</label>
              <textarea
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value.slice(0, 2000))}
                rows={2}
                placeholder="Örn. Ahşap zemin, doğal ışık, minimal dekor"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
              {genError && <p className="mt-2 text-xs text-red-600">{genError}</p>}
            </>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {genShots.map((shot, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span>
                    {shot.status === "pending" && "⏳"}
                    {shot.status === "running" && "🔄"}
                    {shot.status === "done" && "✅"}
                    {shot.status === "error" && "❌"}
                  </span>
                  <span className={shot.status === "pending" ? "text-neutral-400" : ""}>{shot.label}</span>
                  {shot.status === "error" && <span className="text-xs text-red-600">— {shot.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </section>
  );
}

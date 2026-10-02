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
import { tNow as t } from "@/lib/i18n";

const MAX_IMAGES = 20;
const MAX_VIDEOS = 2;

// Etsy'nin önerdiği ürün fotoğrafı çeşitliliği (kapak/açı/detay/ölçek/yaşam tarzı/uzak-yakın çekim). "Oluştur"
// modalinde bir adet ürün fotoğrafından, seçilen adette bu çeşitlilikte bir set otomatik üretilir.
// Komutlar görsel modeline gider ve arayüz dilinden bağımsız olarak İngilizcedir; etiketler iki dillidir.
const SHOT_PRESETS: { label: [string, string]; prompt: string }[] = [
  { label: ["Ana fotoğraf (kapak)", "Main photo (cover)"], prompt: "Show the product on a plain, neutral, clean background, straight from the front, centered, balanced and well lit, in sharp focus. This will be the featured cover photo on Etsy." },
  { label: ["Farklı açı (3/4)", "Different angle (3/4)"], prompt: "Show the same product from a 3/4 angle (slightly from the side); keep the lighting and background consistent." },
  { label: ["Yakın çekim / detay", "Close-up / detail"], prompt: "Show the product's texture, material and craftsmanship in a very close macro shot." },
  { label: ["Ölçek referansı", "Scale reference"], prompt: "Show the product held in a hand or next to an everyday object so its real size is clear." },
  { label: ["Yaşam tarzı (kullanımda)", "Lifestyle (in use)"], prompt: "Show the product in a real setting, in a natural lifestyle scene, being used or displayed." },
  { label: ["Uzak çekim / geniş kadraj", "Wide shot"], prompt: "Show the product from a distance in a wide frame together with its surroundings." },
  { label: ["Arka/üst görünüm", "Back / top view"], prompt: "Show the back of the product or a view from above." },
  { label: ["Alternatif sahne", "Alternative scene"], prompt: "Show the same product on a different surface or decor scene." },
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
    setBusy(t(`Alt metinler yazılıyor (${missingAlt.length})…`, `Writing alt texts (${missingAlt.length})…`));
    try {
      const texts = await generateAlts(missingAlt.map((i) => i.draft_file_id as string));
      onImagesChange(ordered.map((img) => (img.draft_file_id && texts[img.draft_file_id] ? { ...img, alt_text: texts[img.draft_file_id] } : img)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Alt metinler yazılamadı", "Could not write alt texts"));
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
      setAltError(e instanceof Error ? e.message : t("Alt metin yazılamadı", "Could not write alt text"));
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
        setBusy(t(`Fotoğraf ekleniyor (${i + 1}/${files.length})…`, `Adding photo (${i + 1}/${files.length})…`));
        const up = await api.listings.uploadDraftFile(shopId, listingId, files[i], "image", files[i].name);
        current = [...current, imageEntry(up.file_id, null)];
        onImagesChange(withRanks(current));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Bilinmeyen hata", "Unknown error"));
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
      setError(err instanceof Error ? err.message : t("Bilinmeyen hata", "Unknown error"));
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
    setBusy(t("Kırpılan görsel taslağa ekleniyor…", "Adding the cropped image to the draft…"));
    try {
      const up = await api.listings.uploadDraftFile(shopId, listingId, blob, "image", "kirpilmis.jpg");
      const entry = imageEntry(up.file_id, old.alt_text);
      const next = ordered.map((img, i) => (i === cropIdx ? entry : img));
      onImagesChange(withRanks(next));
      onImageReplaced(old.listing_image_id, entry.listing_image_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Bilinmeyen hata", "Unknown error"));
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
            firstError = `${t("Toplu üretimde bir fotoğraf başarısız oldu", "A photo failed during bulk generation")}${jobErr ? `: ${jobErr}` : ""}.`;
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
      const note = genPrompt.trim() ? ` Extra note: ${genPrompt.trim()}` : "";
      const shots = Array.from({ length: qty }, (_, i) => {
        const preset = SHOT_PRESETS[i % SHOT_PRESETS.length];
        const cycle = Math.floor(i / SHOT_PRESETS.length);
        const name = t(...preset.label);
        const label = cycle > 0 ? `${name} (${cycle + 1})` : name;
        const prompt = preset.prompt + note + (cycle > 0 ? " Make it a clearly different variation from the earlier ones." : "");
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
          const msg = e instanceof Error ? e.message : t("Üretilemedi", "Could not generate");
          setGenShots((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: "error", error: msg } : s)));
          break; // ilk hatada dur (ör. kota dolu), kalan çekimleri boşuna deneme
        }
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : t("Görsel üretilemedi", "Could not generate the image"));
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
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Fotoğraf ve video", "Photos and video")}</h2>
      <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
        {t(
          `En fazla ${MAX_IMAGES} fotoğraf ve ${MAX_VIDEOS} video. İlk fotoğraf öne çıkan olur ve küçük resim olarak kullanılır; sıralamak için sürükle. Değişiklikler taslağa kaydedilir, Etsy'ye "Yayınla" ile gider.`,
          `Up to ${MAX_IMAGES} photos and ${MAX_VIDEOS} videos. The first photo is featured and used as the thumbnail; drag to reorder. Changes are saved to the draft and go to Etsy when you publish.`,
        )}
      </p>

      {ordered.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
          <span>
            {t(
              `Alt metin: ${ordered.filter((i) => !!i.alt_text).length}/${ordered.length} fotoğrafta var. Etsy, mevcut fotoğrafların alt metnini değiştirmeye izin vermez; yalnızca yeni yüklenen ya da kırpılan fotoğraflarda yazılabilir.`,
              `Alt text: ${ordered.filter((i) => !!i.alt_text).length}/${ordered.length} photos have it. Etsy does not allow changing alt text on existing photos; it can only be set on newly uploaded or cropped photos.`,
            )}
          </span>
          <div className="flex flex-wrap gap-2">
            {missingAlt.length > 0 && (
              <button type="button" onClick={() => void fillMissingAlts()} disabled={!!busy} className="rounded-full border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950">
                ✨ {t("Eksik alt metinleri yapay zekâyla yaz", "Write missing alt texts with AI")} ({missingAlt.length})
              </button>
            )}
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Set())} className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                {t("Seçimi temizle", "Clear selection")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void (selected.size > 0 ? regenerateSelected() : regenerateAll())}
              disabled={anyRegenBusy}
              title={selected.size > 0 ? t("Yalnızca seçili fotoğrafları yapay zekâyla yeniden oluşturur", "Regenerates only the selected photos with AI") : t("Tüm fotoğrafları, ürünü koruyarak yapay zekâyla tek tek yeniden oluşturur", "Regenerates every photo with AI one by one, keeping the product")}
              className="rounded-full border border-[#D97757] px-3 py-1.5 text-xs font-semibold text-[#D97757] hover:bg-orange-50 disabled:opacity-50 dark:hover:bg-orange-950"
            >
              {bulkRegen
                ? `🪄 ${t("Yeniden oluşturuluyor…", "Regenerating…")}`
                : selected.size > 0
                  ? `🪄 ${t("Seçilenleri yeniden oluştur", "Regenerate selected")} (${selected.size})`
                  : `🪄 ${t("Tüm fotoğrafları yeniden oluştur", "Regenerate all photos")} (${ordered.length})`}
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
            className={`${tile} group cursor-grab ${selected.has(img.listing_image_id) ? "ring-2 ring-[#D97757]" : ""}`}
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
                aria-label={t("Fotoğrafı seç", "Select photo")}
                className="h-3.5 w-3.5"
              />
            </label>
            {i === 0 && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-800">
                {t("Öne çıkan", "Featured")}
              </span>
            )}
            {isDraft(img.listing_image_id) && (
              <span className="absolute left-7 top-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                {t("Yeni", "New")}
              </span>
            )}
            <div className="absolute bottom-1.5 left-1.5 flex gap-1.5">
              <button
                onClick={() => onImagesChange(withRanks(ordered.filter((x) => x.listing_image_id !== img.listing_image_id)))}
                aria-label={t("Fotoğrafı sil", "Delete photo")}
                title={t("Sil", "Delete")}
                className={iconBtn}
              >
                🗑
              </button>
              <button onClick={() => setCropIdx(i)} aria-label={t("Fotoğrafı kırp", "Crop photo")} title={t("Kırp", "Crop")} className={iconBtn}>
                ✂
              </button>
              <button
                onClick={() => void regenerateOne(img)}
                disabled={anyRegenBusy}
                aria-label={t("Yapay zekâyla yeniden oluştur", "Regenerate with AI")}
                title={t("Sihirli değnek: yapay zekâyla yeniden oluştur", "Magic wand: regenerate with AI")}
                className={`${iconBtn} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                🪄
              </button>
            </div>
            <button
              type="button"
              onClick={() => openAlt(i)}
              title={img.alt_text ? `${t("Alt metin", "Alt text")}: ${img.alt_text}` : t("Alt metin ekle", "Add alt text")}
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
                {t("Yeni", "New")}
              </span>
            )}
            <div className="absolute bottom-1.5 left-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onVideosChange(videos.filter((v) => v.video_id !== video.video_id));
                }}
                aria-label={t("Videoyu sil", "Delete video")}
                title={t("Sil", "Delete")}
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
            <span className="text-sm font-semibold">{t("Video ekle", "Add video")}</span>
            <span className="text-xs text-neutral-400">{t(`${MAX_VIDEOS - videos.length} hakkın kaldı`, `${MAX_VIDEOS - videos.length} left`)}</span>
            <input ref={videoInput} type="file" accept="video/*" className="hidden" onChange={addVideo} disabled={!!busy} />
          </label>
        )}

        {ordered.length < MAX_IMAGES && (
          <label className={addTile}>
            <span className="text-2xl">🖼</span>
            <span className="text-sm font-semibold">{t("Fotoğraf ekle", "Add photo")}</span>
            <span className="text-xs text-neutral-400">{t(`${MAX_IMAGES - ordered.length} hakkın kaldı`, `${MAX_IMAGES - ordered.length} left`)}</span>
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
            <span className="text-sm font-semibold">{t("Oluştur", "Generate")}</span>
            <span className="text-xs text-neutral-400">{t("Sıfırdan görsel üret", "Create images from scratch")}</span>
          </button>
        )}
      </div>

      {busy && <p className="mt-3 text-sm text-neutral-500">{busy}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {primary && (
        <div className="mt-6 border-t border-neutral-100 pt-5 dark:border-neutral-800">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-md">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Küçük resimler", "Thumbnails")}</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                {t(
                  "Küçük resimler, öne çıkan fotoğrafının Etsy'de görünen kırpılmış hâlidir. Konunun net ve ortada olması için öne çıkan fotoğrafı kırp.",
                  "Thumbnails are the cropped versions of your featured photo shown on Etsy. Crop the featured photo so the subject is clear and centered.",
                )}
              </p>
            </div>
            <button
              onClick={() => setCropIdx(0)}
              className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              ⤢ {t("Küçük resmi kırp", "Crop thumbnail")}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {[
              { label: t("Kare", "Square"), cls: "aspect-square w-32" },
              { label: t("Dikey", "Portrait"), cls: "aspect-[3/4] w-28" },
              { label: t("Yatay", "Landscape"), cls: "aspect-[4/3] w-40" },
            ].map((shape) => (
              <figure key={shape.label}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={primary.url_570xN}
                  alt=""
                  className={`${shape.cls} rounded-lg border border-neutral-200 object-cover dark:border-neutral-800`}
                />
                <figcaption className="mt-1 text-center text-xs text-neutral-500">{shape.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      {altIdx !== null && ordered[altIdx] && (
        <Modal
          z={120}
          widthClass="max-w-lg"
          title={t("Fotoğraf alt metni", "Photo alt text")}
          footer={
            <>
              <button type="button" onClick={() => setAltIdx(null)} className={btnGhost}>
                {isDraft(ordered[altIdx].listing_image_id) ? t("Vazgeç", "Cancel") : t("Kapat", "Close")}
              </button>
              {isDraft(ordered[altIdx].listing_image_id) && (
                <button type="button" onClick={saveAlt} className={btnPrimary}>
                  {t("Kaydet", "Save")}
                </button>
              )}
            </>
          }
        >
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ordered[altIdx].url_170x135} alt="" className="h-24 w-24 flex-shrink-0 rounded-lg object-cover" />
            <p className="text-xs text-neutral-500">{t("Ekran okuyucular ve aramalar için fotoğrafta görünenin kısa tarifi. Önerilen en fazla 125 karakter, en çok 500.", "A short description of what is in the photo, for screen readers and search. Recommended up to 125 characters, maximum 500.")}</p>
          </div>
          <textarea
            value={altText}
            onChange={(e) => setAltText(e.target.value.slice(0, 500))}
            readOnly={!isDraft(ordered[altIdx].listing_image_id)}
            rows={3}
            placeholder={t("Örn. Siyah metal dağ silüeti, açık gri duvarda", "E.g. Black metal mountain silhouette on a light gray wall")}
            className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className={altText.length > 125 ? "text-amber-600" : "text-neutral-400"}>{altText.length}/125 {t("önerilen", "recommended")}</span>
            {isDraft(ordered[altIdx].listing_image_id) && ordered[altIdx].draft_file_id && (
              <button type="button" onClick={() => void aiForOpenAlt()} disabled={altBusy} className="font-semibold text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400">
                {altBusy ? t("Yazılıyor…", "Writing…") : `✨ ${t("Yapay zekâyla yaz", "Write with AI")}`}
              </button>
            )}
          </div>
          {!isDraft(ordered[altIdx].listing_image_id) && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {t(
                "Bu fotoğraf Etsy'de zaten yüklü ve Etsy API'si mevcut fotoğrafın alt metnini değiştirmeye izin vermiyor. Alt metin yazmak için fotoğrafı kırparak (✂) yeni bir kopya olarak yeniden ekleyebilirsin.",
                "This photo is already on Etsy, and Etsy's API does not allow changing the alt text of an existing photo. To add alt text, crop it (✂) to add it again as a new copy.",
              )}
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
        <Modal z={120} widthClass="max-w-2xl" title={`${t("Fotoğraf", "Photo")} ${viewIdx + 1}/${ordered.length}`} onClose={() => setViewIdx(null)}>
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
              ‹ {t("Önceki", "Previous")}
            </button>
            <button
              type="button"
              onClick={() => { setViewIdx((viewIdx + 1) % ordered.length); setViewPrompt(""); setViewCameraAngle(null); setViewDistance(null); setViewSubjectId(null); }}
              disabled={ordered.length < 2}
              className={`${btnGhost} disabled:opacity-40`}
            >
              {t("Sonraki", "Next")} ›
            </button>
            <button type="button" onClick={() => setCropIdx(viewIdx)} className={btnGhost}>
              ✂️ {t("Kırp", "Crop")}
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
                    🎯 {t("Ürün referansı (opsiyonel)", "Product reference (optional)")}
                    {viewSubjectId !== null && <span className="ml-2 font-normal text-[#D97757]">{t("seçili", "selected")}</span>}
                  </span>
                  <span className="text-neutral-400 transition group-open:rotate-180">▾</span>
                </summary>
                <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
                  <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
                    {t(
                      "Sahnede birden fazla obje olduğunda ya da ürün net seçilemediğinde, hangisinin ürün olduğunu göstermek için temiz bir ürün fotoğrafı seç.",
                      "When the scene has several objects or the product is hard to pick out, choose a clean product photo to show which one is the product.",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setViewSubjectId(null)}
                      className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                        viewSubjectId === null
                          ? "border-[#D97757] text-[#D97757]"
                          : "border-neutral-300 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400"
                      }`}
                    >
                      {t("Yok", "None")}
                    </button>
                    {ordered
                      .filter((_, i) => i !== viewIdx)
                      .map((img) => (
                        <button
                          key={img.listing_image_id}
                          type="button"
                          onClick={() => setViewSubjectId(viewSubjectId === img.listing_image_id ? null : img.listing_image_id)}
                          className={`overflow-hidden rounded-lg border-2 ${
                            viewSubjectId === img.listing_image_id ? "border-[#D97757]" : "border-transparent"
                          }`}
                          title={t("Ürün referansı olarak seç", "Use as product reference")}
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
              <p className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">🪄 {t("Yapay zekâyla düzenle", "Edit with AI")}</p>
              <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
                {t(
                  'Ne değişsin? Ör. "modelin elinde tutsun", "oturma odasında göster", "arka planı beyaz yap". Boş bırakırsan yalnızca doğal/stüdyo kalitesine getirir; belirtmediğin kısımlar (ürünün kendisi) değişmez.',
                  'What should change? E.g. "a model holding it", "show it in a living room", "make the background white". Leave empty to only bring it to natural/studio quality; anything you don\'t mention (the product itself) stays the same.',
                )}
              </p>
              <textarea
                value={viewPrompt}
                onChange={(e) => setViewPrompt(e.target.value.slice(0, 2000))}
                rows={2}
                placeholder={t("Örn. Bu ürünü bir kişi elinde tutuyor gibi göster", "E.g. Show a person holding this product")}
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
                className="rounded-full bg-[#D97757] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d9550f] disabled:opacity-50"
              >
                {regenJobs.get(ordered[viewIdx].listing_image_id)?.phase === "running" ? t("Oluşturuluyor…", "Generating…") : `🪄 ${t("Yeniden oluştur", "Regenerate")}`}
              </button>
              {regenJobs.get(ordered[viewIdx].listing_image_id)?.phase === "error" && (
                <span className="text-xs text-red-600">{regenJobs.get(ordered[viewIdx].listing_image_id)?.error}</span>
              )}
            </div>
          </div>
        </Modal>
      )}

      {genOpen && (
        <Modal z={120} widthClass="max-w-lg" title={t("Fotoğraf seti oluştur", "Generate a photo set")} onClose={genBusy ? undefined : closeGen} footer={
          <>
            <button type="button" onClick={closeGen} disabled={genBusy} className={`${btnGhost} disabled:opacity-40`}>
              {genShots.length > 0 ? t("Bitir", "Done") : t("Vazgeç", "Cancel")}
            </button>
            {genShots.length === 0 && (
              <button type="button" onClick={() => void generateShoot()} disabled={genBusy} className={btnPrimary}>
                {genBusy ? t("Oluşturuluyor…", "Generating…") : t(`${genQty} fotoğraf oluştur`, `Generate ${genQty} photos`)}
              </button>
            )}
          </>
        }>
          {genShots.length === 0 ? (
            <>
              <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
                {t(
                  "Bir ürün fotoğrafı ver — Etsy'nin önerdiği çeşitlilikte (kapak, farklı açı, yakın çekim/detay, ölçek referansı, yaşam tarzı, uzak/geniş kadraj…) bir fotoğraf seti otomatik üretilir, her biri bitikçe listeye eklenir. Fotoğraf vermezsen yalnızca yazdığın tarife göre (hayal ederek) üretir.",
                  "Give a product photo and a set in the variety Etsy recommends (cover, different angle, close-up, scale reference, lifestyle, wide shot…) is generated; each one is added to the list when it is done. Without a photo, images are imagined from your description only.",
                )}
              </p>

              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {t("Ürün fotoğrafı (opsiyonel ama önerilir)", "Product photo (optional but recommended)")}
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
                    {genRefFile ? genRefFile.name : t("Tıkla, sürükle-bırak ya da yapıştır (Ctrl+V)", "Click, drag and drop or paste (Ctrl+V)")}
                  </p>
                  {genRefFile && (
                    <label className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={genKeepRef} onChange={(e) => setGenKeepRef(e.target.checked)} />
                      {t("Bu gerçek fotoğrafı da listeye ekle", "Also add this real photo to the listing")}
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

              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Kaç fotoğraf üretilsin?", "How many photos?")}</label>
              <input
                type="number"
                min={1}
                max={MAX_IMAGES - ordered.length}
                value={genQty}
                onChange={(e) => setGenQty(Math.max(1, Math.min(MAX_IMAGES - ordered.length, Number(e.target.value) || 1)))}
                className="mb-3 w-24 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
              <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
                {t(
                  `${MAX_IMAGES - ordered.length} fotoğraf hakkın kaldı. 8'den fazlasında çekim türleri tekrar edip varyasyon üretilir.`,
                  `${MAX_IMAGES - ordered.length} photos left. Above 8, shot types repeat as variations.`,
                )}
              </p>

              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Ek not (opsiyonel)", "Extra note (optional)")}</label>
              <textarea
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value.slice(0, 2000))}
                rows={2}
                placeholder={t("Örn. Ahşap zemin, doğal ışık, minimal dekor", "E.g. Wooden surface, natural light, minimal decor")}
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

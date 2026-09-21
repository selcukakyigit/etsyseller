"use client";

import { useRef, useState } from "react";
import { api, ListingImage, ListingVideo } from "@/lib/api";
import ImageCropper from "./ImageCropper";

const MAX_IMAGES = 20;
const MAX_VIDEOS = 2;

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
}: {
  shopId: number;
  listingId: number;
  images: ListingImage[];
  videos: ListingVideo[];
  onImagesChange: (images: ListingImage[]) => void;
  onVideosChange: (videos: ListingVideo[]) => void;
  /** Bir görsel kırpılıp yenisiyle değişince eski id'ye bağlı yerleri (varyasyon fotoğrafları) taşımak için. */
  onImageReplaced: (oldId: number, newId: number) => void;
}) {
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [cropIdx, setCropIdx] = useState<number | null>(null);

  const ordered = [...images].sort((a, b) => a.rank - b.rank);
  const primary = ordered[0];

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

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Fotoğraf ve video</h2>
      <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
        En fazla {MAX_IMAGES} fotoğraf ve {MAX_VIDEOS} video. İlk fotoğraf öne çıkan olur ve küçük resim olarak kullanılır;
        sıralamak için sürükle. Değişiklikler taslağa kaydedilir, Etsy&apos;ye &quot;Yayınla&quot; ile gider.
      </p>

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
            className={`${tile} group cursor-grab`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url_570xN} alt={img.alt_text ?? ""} draggable={false} className="h-full w-full object-cover" />
            {i === 0 && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-800">
                Öne çıkan
              </span>
            )}
            {isDraft(img.listing_image_id) && (
              <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
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
            </div>
          </div>
        ))}

        {videos.map((video) => (
          <div key={video.video_id} className={`${tile} group`}>
            {video.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <video src={video.video_url} muted preload="metadata" className="h-full w-full object-cover" />
            )}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-sm shadow">▶</span>
            </span>
            {isDraft(video.video_id) && (
              <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                Yeni
              </span>
            )}
            <div className="absolute bottom-1.5 left-1.5">
              <button
                onClick={() => onVideosChange(videos.filter((v) => v.video_id !== video.video_id))}
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

      {cropIdx !== null && ordered[cropIdx] && (
        <ImageCropper src={cropSource(ordered[cropIdx])} onCancel={() => setCropIdx(null)} onApply={applyCrop} />
      )}
    </section>
  );
}

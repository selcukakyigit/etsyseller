"use client";

import Link from "next/link";
import { useState } from "react";
import { api, API_URL, ChatCard } from "@/lib/api";
import { ImagePlusIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { useT } from "@/lib/i18n-client";
import ImageLightbox from "./ImageLightbox";

type Edited = Extract<ChatCard, { type: "chat_image_edited" }>;

function IconButton({ label, onClick, primary, children }: { label: string; onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
        primary
          ? "bg-[#D97757] text-white hover:bg-[#C6613F]"
          : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

/** Asistanın düzenlediği resim: dokununca büyür, bulanıktan netleşerek açılır; simgeler yeniden üret / listing'e ekle / sil.
 * `onAsk` düğmelerin sohbete gönderdiği isteği iletir (ör. "Listing'e ekle"). */
export default function EditedImageCard({ card, shopId, onAsk }: { card: Edited; shopId: number; onAsk?: (text: string) => void }) {
  const { t } = useT();
  const [loaded, setLoaded] = useState(false);
  const [gone, setGone] = useState(false); // silindi ya da saklama süresi doldu
  const [zoom, setZoom] = useState(false);
  const src = `${API_URL}${card.image_url}`;
  const canAct = !card.added && !gone && onAsk;
  // Listing'e eklenmiş görsel: düğmeler listing'deki fotoğrafı yeniden üretir ya da listing'den kaldırır (asistan aracılığıyla).
  const inListing = card.added && card.listing_id !== null && card.listing_image_id != null && !gone && onAsk;
  const target = card.listing_id !== null ? t(`, listing id: ${card.listing_id}`, `, listing id: ${card.listing_id}`) : "";
  // Yeniden üretme isteği: kaynak sohbet resmi ya da listing fotoğrafı olabilir.
  const source = card.source_image_id
    ? t(`kaynak resim id: ${card.source_image_id}`, `source image id: ${card.source_image_id}`)
    : card.source_listing_id !== null
      ? t(`listing id: ${card.source_listing_id}, fotoğraf ${card.source_photo}`, `listing id: ${card.source_listing_id}, photo ${card.source_photo}`)
      : null;

  async function remove() {
    try {
      await api.assistant.deleteImage(shopId, card.image_id);
    } catch {
      // zaten silinmiş olabilir; kart yine de kapanır
    }
    setGone(true);
  }

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-emerald-300 bg-white dark:border-emerald-800 dark:bg-neutral-900">
      {gone ? (
        <div className="px-3 py-6 text-center text-xs text-neutral-500">{t("Resim silindi", "Image deleted")}</div>
      ) : (
        <button type="button" onClick={() => setZoom(true)} className="block w-full cursor-zoom-in bg-neutral-100 dark:bg-neutral-800" aria-label={t("Büyüt", "Enlarge")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            onLoad={() => setLoaded(true)}
            onError={() => setGone(true)}
            className={`mx-auto max-h-80 w-full object-contain transition-[filter,transform] duration-700 ${loaded ? "blur-0 scale-100" : "scale-105 blur-xl"}`}
          />
        </button>
      )}
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span className="text-neutral-600 dark:text-neutral-300">
          {card.added ? t("Oluşturuldu ve listing taslağına eklendi", "Created and added to the listing draft") : t("Oluşturuldu · listing'e eklenmedi", "Created · not added to the listing")}
        </span>
        {card.added && card.edit_url && (
          <Link href={card.edit_url} className="flex-shrink-0 font-semibold text-[#B4553A] hover:underline dark:text-[#E89A7F]">
            {t("Aç →", "Open →")}
          </Link>
        )}
      </div>
      {canAct && (
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
          {source && (
            <IconButton
              label={t("Yeniden üret", "Regenerate")}
              onClick={() => onAsk(t(`Bu görseli yeniden üret, listing'e ekleme (${source}): ${card.prompt}`, `Regenerate this image without adding it to the listing (${source}): ${card.prompt}`))}
            >
              <RefreshIcon className="!h-4 !w-4" />
            </IconButton>
          )}
          <IconButton label={t("Sil", "Delete")} onClick={() => void remove()}>
            <TrashIcon />
          </IconButton>
          <IconButton
            primary
            label={t("Listing'e ekle", "Add to listing")}
            onClick={() => onAsk(t(`Bu resmi listing'e ekle (resim id: ${card.image_id}${target})`, `Add this image to the listing (image id: ${card.image_id}${target})`))}
          >
            <ImagePlusIcon className="!h-4 !w-4" />
          </IconButton>
        </div>
      )}
      {inListing && (
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
          <IconButton
            label={t("Yeniden üret (listing'deki yerine)", "Regenerate (replaces it in the listing)")}
            onClick={() =>
              onAsk(
                t(
                  `Listing'deki bu fotoğrafı yeniden üret ve yerine koy (listing id: ${card.listing_id}, fotoğraf image id: ${card.listing_image_id}): ${card.prompt}`,
                  `Regenerate this listing photo and replace it in place (listing id: ${card.listing_id}, photo image id: ${card.listing_image_id}): ${card.prompt}`,
                ),
              )
            }
          >
            <RefreshIcon className="!h-4 !w-4" />
          </IconButton>
          <IconButton
            label={t("Listing'den kaldır", "Remove from listing")}
            onClick={() =>
              onAsk(
                t(
                  `Bu fotoğrafı listing'den kaldır (listing id: ${card.listing_id}, fotoğraf image id: ${card.listing_image_id})`,
                  `Remove this photo from the listing (listing id: ${card.listing_id}, photo image id: ${card.listing_image_id})`,
                ),
              )
            }
          >
            <TrashIcon />
          </IconButton>
        </div>
      )}
      {zoom && <ImageLightbox src={src} onClose={() => setZoom(false)} />}
    </div>
  );
}

"use client";

import { ListingImage } from "@/lib/api";
import { Modal, btnGhost } from "./Modal";
import { tNow as t } from "@/lib/i18n";

export default function PhotoPicker({
  subtitle,
  images,
  selected,
  onPick,
  onCancel,
}: {
  subtitle: string;
  images: ListingImage[];
  selected: number | null;
  onPick: (imageId: number | null) => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      z={70}
      title={t("Bu seçeneğe fotoğraf bağla", "Link a photo to this option")}
      footer={
        <button onClick={onCancel} className={btnGhost}>
          {t("Vazgeç", "Cancel")}
        </button>
      }
    >
      <p className="mb-3 text-sm text-neutral-500">{subtitle}</p>
      <p className="mb-4 text-sm text-neutral-700 dark:text-neutral-300">
        {t("Alıcılar bu seçeneği görüntülerken göstermek istediğin fotoğrafı seç.", "Choose the photo buyers see when they view this option.")}
      </p>
      {images.length === 0 && <p className="text-sm text-neutral-400">{t("Listing'de henüz fotoğraf yok.", "The listing has no photos yet.")}</p>}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {images.map((img) => (
          <button
            key={img.listing_image_id}
            onClick={() => onPick(img.listing_image_id)}
            className={`overflow-hidden rounded-lg border-2 ${
              selected === img.listing_image_id
                ? "border-neutral-900 dark:border-neutral-100"
                : "border-neutral-200 dark:border-neutral-800"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url_170x135} alt={img.alt_text ?? ""} className="aspect-[4/3] w-full object-cover" />
          </button>
        ))}
      </div>
      <button
        onClick={() => onPick(null)}
        className="mt-4 rounded-full bg-neutral-100 px-4 py-2 text-sm font-semibold dark:bg-neutral-800"
      >
        {t("Hiçbiri", "None")}
      </button>
    </Modal>
  );
}

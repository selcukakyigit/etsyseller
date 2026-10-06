"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ListingImage } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

/** Ürün referansı: yeni bir dosya ya da listing'in kendi fotoğraflarından biri (biri seçilince diğeri temizlenir). */
export type ReferenceValue = { file: File | null; image: ListingImage | null; keepFile: boolean };

export const emptyReference: ReferenceValue = { file: null, image: null, keepFile: false };

/** Seçili referans tek satırda görünür. Listing fotoğrafları yalnızca "Listeden seç" ile açılır; pencere açıkken Ctrl+V
 *  ile yapıştırılan görsel de referans olur. */
export default function ReferencePicker({
  images,
  value,
  onChange,
  disabled,
}: {
  images: ListingImage[];
  value: ReferenceValue;
  onChange: (next: ReferenceValue) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [listOpen, setListOpen] = useState(false);
  const preview = useMemo(() => (value.file ? URL.createObjectURL(value.file) : null), [value.file]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    if (disabled) return;
    function onPaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.items ?? []).find((it) => it.type.startsWith("image/"))?.getAsFile();
      if (file) onChangeRef.current({ file, image: null, keepFile: false });
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [disabled]);

  const pickFile = (file: File | null | undefined) => file && onChange({ file, image: null, keepFile: false });
  const thumb = preview ?? value.image?.url_170x135 ?? null;
  const btn =
    "rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Ürün fotoğrafı (önerilir)", "Product photo (recommended)")}</p>
      {thumb ? (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb} alt="" className="h-14 w-14 flex-shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-neutral-800 dark:text-neutral-200">
              {value.file ? value.file.name : t(`Listing fotoğrafı #${value.image?.rank ?? ""}`, `Listing photo #${value.image?.rank ?? ""}`)}
            </p>
            {value.file && (
              <label className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <input type="checkbox" checked={value.keepFile} disabled={disabled} onChange={(e) => onChange({ ...value, keepFile: e.target.checked })} />
                {t("Bu fotoğrafı da listeye ekle", "Also add this photo to the listing")}
              </label>
            )}
          </div>
          <button type="button" disabled={disabled} onClick={() => onChange(emptyReference)} className={btn}>
            {t("Kaldır", "Remove")}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/")));
            }}
            className="flex-1 rounded-lg border-2 border-dashed border-neutral-300 px-3 py-3 text-left text-xs text-neutral-600 transition hover:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500"
          >
            {t("Yükle, sürükle-bırak ya da yapıştır (Ctrl+V)", "Upload, drag and drop or paste (Ctrl+V)")}
          </button>
          {images.length > 0 && (
            <button type="button" disabled={disabled} onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen} className={btn}>
              {t("Listeden seç", "Pick from listing")}
            </button>
          )}
        </div>
      )}
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
      {listOpen && !thumb && (
        <div className="mt-2 grid grid-cols-5 gap-1.5 sm:grid-cols-6">
          {images.map((img) => (
            <button
              key={img.listing_image_id}
              type="button"
              onClick={() => {
                onChange({ file: null, image: img, keepFile: false });
                setListOpen(false);
              }}
              title={t("Ürün referansı olarak kullan", "Use as product reference")}
              className="overflow-hidden rounded-md border-2 border-transparent transition hover:border-[#D97757]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url_170x135} alt="" className="aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

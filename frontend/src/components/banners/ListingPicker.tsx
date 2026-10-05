"use client";

import { useMemo, useState } from "react";
import { Listing } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { SearchIcon } from "@/components/ui/Popover";

/** Banner'da kullanılacak ilanları seçer (sıralı: collage'da 1. seçilen 1. kareye gider). Her ilanın ilk fotoğrafı kullanılır. */
export default function ListingPicker({
  listings,
  initial,
  max,
  onDone,
  onClose,
}: {
  listings: Listing[];
  initial: number[];
  max: number;
  onDone: (ids: number[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [picked, setPicked] = useState<number[]>(initial);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => l.image_url && !l.is_new && (!q || l.title.toLowerCase().includes(q)));
  }, [listings, query]);

  function toggle(id: number) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= max ? p : [...p, id]));
  }

  return (
    <Modal
      title={t(`İlan seç (en fazla ${max})`, `Pick listings (up to ${max})`)}
      widthClass="max-w-4xl"
      z={90}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
            {picked.length}/{max}
          </span>
          <button type="button" onClick={onClose} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button type="button" onClick={() => onDone(picked)} className={btnPrimary}>
            {t("Seç", "Select")}
          </button>
        </>
      }
    >
      <div className="relative mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Başlıkta ara", "Search titles")}
          className="h-9 w-full rounded-full border border-neutral-300 bg-white pl-9 pr-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {visible.slice(0, 200).map((l) => {
          const order = picked.indexOf(l.listing_id);
          const full = order < 0 && picked.length >= max;
          return (
            <button
              key={l.listing_id}
              type="button"
              onClick={() => toggle(l.listing_id)}
              disabled={full}
              title={l.title}
              className={`relative aspect-square overflow-hidden rounded-lg border-2 transition disabled:opacity-40 ${
                order >= 0 ? "border-[#D97757]" : "border-transparent hover:border-neutral-300 dark:hover:border-neutral-600"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.image_url ?? ""} alt="" loading="lazy" className="h-full w-full object-cover" />
              {order >= 0 && (
                <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#D97757] text-xs font-semibold text-white shadow">
                  {order + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {visible.length === 0 && <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">{t("Eşleşen ilan yok.", "No matching listings.")}</p>}
    </Modal>
  );
}

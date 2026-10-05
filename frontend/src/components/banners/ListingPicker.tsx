"use client";

import { useMemo, useState } from "react";
import { Listing, ShopSection } from "@/lib/api";
import { useT } from "@/lib/i18n-client";
import { useIncrementalList } from "@/lib/useIncrementalList";
import { Modal, btnGhost, btnPrimary } from "@/components/listing-editor/Modal";
import { SearchIcon } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";

const NO_SECTION = -1;

/** Banner'da kullanılacak ilanları seçer (sıralı: collage'da 1. seçilen 1. kareye gider). Her ilanın ilk fotoğrafı kullanılır.
 *  Bölüme göre süzülebilir; tüm ilanlar kaydırdıkça yüklenir. */
export default function ListingPicker({
  listings,
  sections,
  initial,
  max,
  onDone,
  onClose,
}: {
  listings: Listing[];
  sections: ShopSection[];
  initial: number[];
  max: number;
  onDone: (ids: number[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [picked, setPicked] = useState<number[]>(initial);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<number | null>(null); // null = tümü

  const usable = useMemo(() => listings.filter((l) => l.image_url && !l.is_new), [listings]);

  // Bölüm sayıları seçicideki ilanlardan (Etsy'nin "aktif" sayısı değil); ilanı olmayan bölüm gösterilmez.
  const sectionCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const l of usable) {
      const id = l.shop_section_id ?? NO_SECTION;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [usable]);
  const sectionChips = sections.filter((s) => sectionCounts.get(s.shop_section_id));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return usable.filter(
      (l) => (section === null || (l.shop_section_id ?? NO_SECTION) === section) && (!q || l.title.toLowerCase().includes(q)),
    );
  }, [usable, query, section]);
  const { shown, hasMore, sentinelRef } = useIncrementalList(visible, 40, `${section}|${query}`);

  function toggle(id: number) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= max ? p : [...p, id]));
  }

  /** Görünen ilanlardan (bölüm/arama süzgecinden) seçilmemiş olanları, boş yer kadar ekler. */
  function pickVisible() {
    setPicked((p) => [...p, ...visible.map((l) => l.listing_id).filter((id) => !p.includes(id))].slice(0, max));
  }

  const chip = (on: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
      on
        ? "border-[#D97757] bg-[#D97757]/10 text-[#B4553A] dark:text-[#E89A7F]"
        : "border-neutral-200 text-neutral-700 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
    }`;

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
            {picked.length > 0 && (
              <button type="button" onClick={() => setPicked([])} className="ml-3 text-xs hover:underline">
                {t("Temizle", "Clear")}
              </button>
            )}
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

      {(sectionChips.length > 0 || sectionCounts.has(NO_SECTION)) && (
        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap">
          <button type="button" onClick={() => setSection(null)} className={chip(section === null)}>
            {t("Tümü", "All")} <span className="tabular-nums opacity-60">{usable.length}</span>
          </button>
          {sectionChips.map((s) => (
            <button key={s.shop_section_id} type="button" onClick={() => setSection(s.shop_section_id)} className={chip(section === s.shop_section_id)}>
              {s.title} <span className="tabular-nums opacity-60">{sectionCounts.get(s.shop_section_id)}</span>
            </button>
          ))}
          {sectionCounts.has(NO_SECTION) && sectionChips.length > 0 && (
            <button type="button" onClick={() => setSection(NO_SECTION)} className={chip(section === NO_SECTION)}>
              {t("Bölümsüz", "No section")} <span className="tabular-nums opacity-60">{sectionCounts.get(NO_SECTION)}</span>
            </button>
          )}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="tabular-nums">{t(`${visible.length} ilan`, `${visible.length} listings`)}</span>
        {(section !== null || query.trim()) && visible.length > 0 && picked.length < max && (
          <button type="button" onClick={pickVisible} className="font-medium text-[#B4553A] hover:underline dark:text-[#E89A7F]">
            {t(`Bunlardan seç (${Math.min(max - picked.length, visible.filter((l) => !picked.includes(l.listing_id)).length)})`, `Pick from these (${Math.min(max - picked.length, visible.filter((l) => !picked.includes(l.listing_id)).length)})`)}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {shown.map((l) => {
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
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <Spinner size={18} />
        </div>
      )}
      {visible.length === 0 && <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">{t("Eşleşen ilan yok.", "No matching listings.")}</p>}
    </Modal>
  );
}

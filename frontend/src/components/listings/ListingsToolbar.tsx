"use client";

import { ReactNode } from "react";
import { useT } from "@/lib/i18n-client";
import { ChoiceMenu, Popover, SearchIcon, SortIcon, menuBox, menuItem } from "@/components/ui/Popover";

export type ListingSort = "ending" | "modified" | "views" | "favorites" | "price_asc" | "price_desc" | "title";

const SORTS: [ListingSort, string, string][] = [
  ["ending", "Bitiş: en yeni önce", "Expiration: newest first"],
  ["modified", "Son düzenlenen", "Recently edited"],
  ["views", "En çok görüntülenen", "Most viewed"],
  ["favorites", "En çok favorilenen", "Most favorited"],
  ["price_asc", "Fiyat: düşükten yükseğe", "Price: low to high"],
  ["price_desc", "Fiyat: yüksekten düşüğe", "Price: high to low"],
  ["title", "Başlık (A–Z)", "Title (A–Z)"],
];

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

/** Listing'ler sayfasının üst kısmı: başlık + yeni listing, arama + filtre + sıralama + görünüm, seçim satırı.
 *  Toplu işlemler burada değil, bir şey seçilince alttan çıkan SelectionBar'da. */
export default function ListingsToolbar({
  total,
  visible,
  draftCount,
  query,
  onQuery,
  sort,
  onSort,
  view,
  onView,
  filterButton,
  onNew,
  busy,
  allSelected,
  selectedCount,
  onToggleAll,
  onSelectUnpublished,
  onFullSync,
}: {
  total: number;
  visible: number;
  draftCount: number;
  query: string;
  onQuery: (q: string) => void;
  sort: ListingSort;
  onSort: (s: ListingSort) => void;
  view: "grid" | "list";
  onView: (v: "grid" | "list") => void;
  /** Mobil filtre düğmesi (lg+ ekranda filtre paneli yerinde durduğu için gizlidir). */
  filterButton: ReactNode;
  onNew: () => void;
  busy: boolean;
  allSelected: boolean;
  selectedCount: number;
  onToggleAll: (on: boolean) => void;
  onSelectUnpublished: () => void;
  onFullSync: () => void;
}) {
  const { t } = useT();
  const sortLabel = SORTS.find(([k]) => k === sort) ?? SORTS[0];

  // Filtre, sıralama ve görünüm: geniş ekranda aramanın yanında, telefonda seçim satırının sağında.
  const controls = (
    <>
      {filterButton}
      <ChoiceMenu
        label={t("Sırala", "Sort")}
        value={sort}
        onChange={onSort}
        options={SORTS.map(([value, tr, en]) => ({ value, label: t(tr, en) }))}
        button={
          <>
            <SortIcon />
            <span className="hidden max-w-[11rem] truncate md:inline">{t(sortLabel[1], sortLabel[2])}</span>
          </>
        }
      />
      <div className="flex h-9 shrink-0 items-center rounded-full border border-neutral-300 p-0.5 dark:border-neutral-700" role="group" aria-label={t("Görünüm", "View")}>
        {(["grid", "list"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            aria-pressed={view === v}
            aria-label={v === "grid" ? t("Kart görünümü", "Grid view") : t("Liste görünümü", "List view")}
            className={`flex h-full w-8 items-center justify-center rounded-full transition ${
              view === v ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            }`}
          >
            {v === "grid" ? <GridIcon /> : <ListIcon />}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("Listing'ler", "Listings")}</h1>
        <span className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">{visible === total ? total : `${visible}/${total}`}</span>
        <div className="ml-auto flex items-center gap-2">
          <Popover label={t("Diğer", "More")} button={<span className="text-base leading-none">⋯</span>}>
            {(close) => (
              <div role="menu" className={`${menuBox} w-60`}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onFullSync();
                  }}
                  className={menuItem}
                >
                  <span>
                    <span className="block">{t("Tam senkronizasyon", "Full sync")}</span>
                    <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">{t("Tüm listing'leri Etsy'den baştan çeker", "Fetches every listing from Etsy again")}</span>
                  </span>
                </button>
              </div>
            )}
          </Popover>
          <button
            type="button"
            onClick={onNew}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-full bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <span className="sm:hidden">{t("+ Yeni", "+ New")}</span>
            <span className="hidden sm:inline">{t("+ Yeni listing", "+ New listing")}</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("Başlık, etiket veya SKU ara", "Search title, tag or SKU")}
            enterKeyHint="search"
            className="h-9 w-full rounded-full border border-neutral-300 bg-white pl-9 pr-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-[#D97757] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">{controls}</div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-neutral-700 dark:text-neutral-200">
          <input type="checkbox" checked={allSelected} onChange={(e) => onToggleAll(e.target.checked)} className="h-4 w-4 accent-[#D97757]" />
          {selectedCount > 0 ? t(`${selectedCount} seçili`, `${selectedCount} selected`) : t("Tümünü seç", "Select all")}
        </label>
        {draftCount > 0 && (
          <button
            type="button"
            onClick={onSelectUnpublished}
            title={t("Etsy'ye henüz gönderilmemiş değişikliği olan listing'leri seç", "Select listings with changes not yet sent to Etsy")}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
          >
            {t("Yayınlanmamışlar", "Unpublished")}
            <span className="rounded-full bg-amber-200/70 px-1.5 tabular-nums dark:bg-amber-900/60">{draftCount}</span>
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:hidden">{controls}</div>
      </div>
    </div>
  );
}

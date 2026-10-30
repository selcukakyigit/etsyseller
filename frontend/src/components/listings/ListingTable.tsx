"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { CardSale, FadedInfo, Listing, TrackedRank } from "@/lib/api";
import type { PublishJob } from "@/lib/publishJobs";
import { useT } from "@/lib/i18n-client";
import HelpTip from "@/components/ui/HelpTip";
import PublishBar from "@/components/listings/PublishBar";
import ListingActionMenu, { type CardAction } from "./ListingActionMenu";
import ListingDateBadges, { FadedBadge, RankBadge } from "./ListingDateBadges";
import { formatPrice } from "./ListingCard";
import { conversionPct, nextSort, type TableKey, type TableSort } from "./tableSort";

const badge = "rounded-full px-2 py-0.5 text-[11px] font-semibold";
const num = "px-3 py-2 text-right tabular-nums";

export type TableRowProps = {
  listing: Listing;
  selected: boolean;
  onSelectChange: (on: boolean) => void;
  onAction: (action: CardAction) => void;
  publishing: boolean;
  publishError?: string | null;
  job?: PublishJob;
  faded?: FadedInfo;
  rank?: TrackedRank;
  sales?: CardSale;
  touchedAt: number;
};

/** Analiz görünümü: kartlardaki rakamların aynısı, sıkı bir tabloda; başlığa tıklayarak sıralanır. Telefonda yalnızca satış ve görüntülenme kalır. */
export default function ListingTable({
  rows,
  sort,
  onSort,
  rankMax,
  allSelected,
  onToggleAll,
}: {
  rows: TableRowProps[];
  sort: TableSort;
  onSort: (s: TableSort) => void;
  rankMax: number;
  allSelected: boolean;
  onToggleAll: (on: boolean) => void;
}) {
  const { t } = useT();
  const head = (key: TableKey, label: string, opts: { cls?: string; left?: boolean; tip?: ReactNode } = {}) => {
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2 font-medium ${opts.left ? "text-left" : "text-right"} ${opts.cls ?? ""}`}>
        <span className={`inline-flex items-center gap-1 ${opts.left ? "" : "flex-row-reverse"}`}>
          <button
            type="button"
            onClick={() => onSort(nextSort(sort, key))}
            className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-neutral-900 dark:hover:text-neutral-100 ${active ? "text-neutral-900 dark:text-neutral-100" : ""}`}
          >
            {label}
            <span aria-hidden className={`text-[9px] ${active ? "" : "opacity-0"}`}>
              {sort.dir === "asc" ? "▲" : "▼"}
            </span>
          </button>
          {opts.tip && <HelpTip align={opts.left ? "left" : "right"}>{opts.tip}</HelpTip>}
        </span>
      </th>
    );
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <tr>
            <th scope="col" className="w-9 px-3 py-2">
              <input type="checkbox" checked={allSelected} onChange={(e) => onToggleAll(e.target.checked)} aria-label={t("Tümünü seç", "Select all")} className="h-4 w-4 accent-[#D97757]" />
            </th>
            {head("title", t("Listing", "Listing"), { left: true })}
            {head("price", t("Fiyat", "Price"), { cls: "hidden md:table-cell" })}
            {head("stock", t("Stok", "Stock"), { cls: "hidden md:table-cell" })}
            {head("sales_month", t("Satış (bu ay)", "Sales (this month)"))}
            {head("sales_total", t("Satış (toplam)", "Sales (total)"), { cls: "hidden lg:table-cell" })}
            {head("views", t("Görüntülenme", "Views"))}
            {head("favorites", t("Favori", "Favorites"), { cls: "hidden md:table-cell" })}
            {head("conversion", t("Dönüşüm", "Conversion"), {
              cls: "hidden lg:table-cell",
              tip: t(
                "Toplam satış ÷ toplam görüntülenme. Sipariş geçmişi listing'in ömründen kısaysa gerçekte olduğundan düşük görünebilir.",
                "Total sales ÷ total views. If the order history is shorter than the listing's life it can look lower than it really is.",
              ),
            })}
            {head("rank", t("Sıra", "Rank"), {
              cls: "hidden md:table-cell",
              tip: t(
                "Sıra takibindeki en iyi aramada Etsy API sırası (küçük = iyi). Sitedeki alıcı sırası değildir.",
                "Etsy API position for the best tracked search (lower = better). This is not the buyer's ranking on the site.",
              ),
            })}
            {head("updated", t("Güncelleme", "Updated"), { cls: "hidden xl:table-cell", left: true })}
            <th scope="col" className="w-24 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.listing.listing_id} row={r} rankMax={rankMax} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row, rankMax }: { row: TableRowProps; rankMax: number }) {
  const { t, locale } = useT();
  const { listing, sales, rank, faded, job, publishError } = row;
  const state = listing.state ?? "active";
  const price = formatPrice(listing, locale);
  const conv = conversionPct(listing.views, sales);
  const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString(locale));
  const dim = (v: number | null | undefined) => (v ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-400 dark:text-neutral-600");
  const stateLabel: Record<string, string> = { inactive: t("Pasif", "Inactive"), draft: t("Etsy taslağı", "Etsy draft"), expired: t("Süresi dolmuş", "Expired"), sold_out: t("Tükenmiş", "Sold out") };

  return (
    <>
      <tr className={`border-b border-neutral-100 last:border-0 dark:border-neutral-800 ${row.selected ? "bg-[#D97757]/5" : ""}`}>
        <td className="px-3 py-2 align-top">
          <input type="checkbox" checked={row.selected} onChange={(e) => row.onSelectChange(e.target.checked)} aria-label={t(`${listing.title} seç`, `Select ${listing.title}`)} className="mt-1 h-4 w-4 accent-[#D97757]" />
        </td>
        <td className="min-w-0 px-3 py-2">
          <div className="flex items-start gap-2.5">
            <Link href={`/listings/${listing.listing_id}/edit`} className="block h-10 w-10 shrink-0 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800">
              {listing.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={listing.image_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              )}
            </Link>
            <div className="min-w-0">
              <Link href={`/listings/${listing.listing_id}/edit`} title={listing.title} className="line-clamp-2 font-medium leading-snug text-neutral-900 hover:underline dark:text-neutral-100">
                {listing.title}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                {listing.is_new && <span className={`${badge} bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300`}>{t("Yeni · Etsy'de yok", "New · not on Etsy")}</span>}
                {listing.has_local && !listing.is_new && <span className={`${badge} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300`}>{t("Yayınlanmadı", "Unpublished")}</span>}
                {listing.has_draft && <span className={`${badge} bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300`}>{t("Taslak", "Draft")}</span>}
                {state !== "active" && !listing.is_new && <span className={`${badge} bg-neutral-800 text-white dark:bg-neutral-700`}>{stateLabel[state] ?? state}</span>}
                {listing.has_video && <span className={`${badge} bg-amber-300 text-neutral-900`}>Video</span>}
                <FadedBadge info={faded} />
              </div>
              {publishError && <p className="mt-0.5 text-xs text-red-600">{publishError}</p>}
            </div>
          </div>
        </td>
        <td className={`${num} hidden md:table-cell`}>{price ? <span className="font-medium text-[#1a7f4b] dark:text-green-400">{price}</span> : "—"}</td>
        <td className={`${num} hidden md:table-cell ${dim(listing.quantity)}`}>{n(listing.quantity)}</td>
        <td className={`${num} ${dim(sales?.this_month)}`}>{n(sales?.this_month)}</td>
        <td className={`${num} hidden lg:table-cell ${dim(sales?.total)}`}>{n(sales?.total)}</td>
        <td className={`${num} ${dim(listing.views)}`}>{n(listing.views)}</td>
        <td className={`${num} hidden md:table-cell ${dim(listing.favorites)}`}>{n(listing.favorites)}</td>
        <td className={`${num} hidden lg:table-cell ${dim(conv)}`}>{conv == null ? "—" : `${conv.toLocaleString(locale, { maximumFractionDigits: 1 })}%`}</td>
        <td className="hidden px-3 py-2 text-right text-xs md:table-cell">{rank ? <RankBadge info={rank} maxResults={rankMax} /> : <span className="text-neutral-400 dark:text-neutral-600">—</span>}</td>
        <td className="hidden px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 xl:table-cell">
          <div className="flex flex-col items-start gap-0.5">
            <ListingDateBadges updated={listing.updated_timestamp} renewed={listing.renewed_timestamp} />
          </div>
        </td>
        <td className="px-3 py-2 align-top">
          <div className="flex items-center justify-end gap-0.5">
            <button
              type="button"
              onClick={() => row.onAction("preview")}
              title={t("Alıcıya nasıl görüneceğini önizle", "Preview how buyers will see it")}
              className="rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              {t("Önizle", "Preview")}
            </button>
            <ListingActionMenu listing={listing} publishing={row.publishing} onAction={row.onAction} />
          </div>
        </td>
      </tr>
      {job && (
        <tr className="border-b border-neutral-100 dark:border-neutral-800">
          <td colSpan={12} className="px-3 pb-2">
            <PublishBar id={listing.listing_id} job={job} />
          </td>
        </tr>
      )}
    </>
  );
}

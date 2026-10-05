"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Listing } from "@/lib/api";
import { PublishJob } from "@/lib/publishJobs";
import PublishBar from "@/components/listings/PublishBar";
import { useT } from "@/lib/i18n-client";

export type CardAction = "preview" | "stats" | "copy" | "activate" | "deactivate" | "renew" | "section" | "delete" | "publish";

export function formatPrice(l: Listing, locale = "tr-TR"): string | null {
  if (l.price_min == null) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: l.currency || "USD" }).format(n);
  return l.price_max != null && l.price_max !== l.price_min ? `${fmt(l.price_min)} – ${fmt(l.price_max)}` : fmt(l.price_min);
}

const badge = "rounded-full px-2 py-0.5 text-[11px] font-semibold";

/** Etsy Shop Manager'daki listing kartının karşılığı: görsel, başlık, stok/fiyat, istatistik, seçim ve işlem menüsü. */
export default function ListingCard({
  listing,
  selected,
  onSelectChange,
  onAction,
  publishing,
  publishError,
  job,
}: {
  listing: Listing;
  selected: boolean;
  onSelectChange: (on: boolean) => void;
  onAction: (action: CardAction) => void;
  publishing: boolean;
  publishError?: string | null;
  job?: PublishJob;
}) {
  const { t, locale } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const state = listing.state ?? "active";
  const item = (key: CardAction, label: string, danger = false, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setMenuOpen(false);
        onAction(key);
      }}
      className={`block w-full px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800 ${danger ? "text-red-600" : ""}`}
    >
      {label}
    </button>
  );
  const price = formatPrice(listing, locale);
  const renews = listing.ending_timestamp
    ? new Date(listing.ending_timestamp * 1000).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
    : null;
  const skus = (listing.skus ?? []).join(", ");

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-white dark:bg-neutral-900 ${
        selected ? "border-[#D97757]" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <Link href={`/listings/${listing.listing_id}/edit`} className="relative block aspect-square bg-neutral-100 dark:bg-neutral-800">
        {listing.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.image_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        )}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {listing.is_new && <span className={`${badge} bg-sky-100 text-sky-800`}>{t("Yeni · Etsy'de yok", "New · not on Etsy")}</span>}
          {listing.has_local && !listing.is_new && <span className={`${badge} bg-amber-100 text-amber-800`}>{t("Yayınlanmadı", "Unpublished")}</span>}
          {listing.has_draft && <span className={`${badge} bg-neutral-200 text-neutral-700`}>{t("Taslak", "Draft")}</span>}
          {state !== "active" && !listing.is_new && <span className={`${badge} bg-neutral-800 text-white`}>{{ inactive: t("Pasif", "Inactive"), draft: t("Etsy taslağı", "Etsy draft"), expired: t("Süresi dolmuş", "Expired"), sold_out: t("Tükenmiş", "Sold out") }[state] ?? state}</span>}
        </div>
        {listing.has_video && (
          <span className={`${badge} absolute bottom-2 left-2 bg-amber-300 text-neutral-900`}>Video</span>
        )}
      </Link>

      <div className="flex-1 space-y-1 p-2.5 text-xs text-neutral-500 dark:text-neutral-400 sm:p-3">
        <Link
          href={`/listings/${listing.listing_id}/edit`}
          title={listing.title}
          className="line-clamp-2 text-sm font-semibold leading-snug text-neutral-900 hover:underline dark:text-neutral-100 sm:line-clamp-1"
        >
          {listing.title}
        </Link>
        {listing.quantity != null && <p>{t(`${listing.quantity} stokta`, `${listing.quantity} in stock`)}</p>}
        {skus && (
          <p className="hidden truncate sm:block" title={skus}>
            {skus}
          </p>
        )}
        {price && <p className="text-[#1a7f4b] dark:text-green-400">{price}</p>}
        {renews && <p className="hidden sm:block">{listing.should_auto_renew ? t("Otomatik yenilenir", "Auto-renews") : t("Sona erer", "Expires")} {renews}</p>}
        <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <p className="hidden text-[10px] font-semibold uppercase tracking-wide sm:block">{t("İstatistikler", "Stats")}</p>
          <p>
            {listing.views ?? 0} {t("görüntülenme", "views")} · {listing.favorites ?? 0} {t("favori", "favorites")}
          </p>
        </div>
        {publishError && <p className="text-red-600">{publishError}</p>}
      </div>

      <div className="flex items-center justify-between border-t border-neutral-100 px-2.5 py-1.5 dark:border-neutral-800 sm:px-3 sm:py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectChange(e.target.checked)}
          aria-label={t(`${listing.title} seç`, `Select ${listing.title}`)}
          className="h-4 w-4 accent-[#D97757]"
        />
        <button
          type="button"
          onClick={() => onAction("preview")}
          title={t("Alıcıya nasıl görüneceğini önizle", "Preview how buyers will see it")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {t("Önizle", "Preview")}
        </button>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t("İşlemler", "Actions")}
            className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ⚙ ▾
          </button>
          {menuOpen && (
            <div className="absolute bottom-full right-0 z-20 mb-1 w-44 overflow-hidden sm:w-52 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              {listing.url && !listing.is_new && (
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  {t("Etsy'de görüntüle ↗", "View on Etsy ↗")}
                </a>
              )}
              {item("preview", t("Önizle", "Preview"))}
              {!listing.is_new && item("stats", t("İstatistikleri gör", "View stats"))}
              <Link
                href={`/listings/${listing.listing_id}/edit`}
                className="block px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                {t("Düzenle", "Edit")}
              </Link>
              {!listing.is_new && item("copy", t("Kopyala", "Copy"))}
              {listing.has_local && item("publish", publishing ? t("Yayınlanıyor…", "Publishing…") : listing.is_new ? t("Etsy'de oluştur", "Create on Etsy") : t("Etsy'de yayınla", "Publish to Etsy"), false, publishing)}
              <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
              {!listing.is_new && state === "active" && item("deactivate", t("Pasife al", "Deactivate"))}
              {!listing.is_new && (state === "inactive" || state === "draft") && item("activate", t("Aktif et", "Activate"))}
              {!listing.is_new && (state === "expired" || state === "sold_out") && item("renew", t("Yenile", "Renew"))}
              {!listing.is_new && item("section", t("Bölümü değiştir", "Change section"))}
              <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
              {item("delete", listing.is_new ? t("Vazgeç (yerel listing'i sil)", "Discard (delete local listing)") : t("Sil", "Delete"), true)}
            </div>
          )}
        </div>
      </div>
      {job && <PublishBar id={listing.listing_id} job={job} />}
    </div>
  );
}

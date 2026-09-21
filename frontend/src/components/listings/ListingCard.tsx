"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Listing } from "@/lib/api";

export function formatPrice(l: Listing): string | null {
  if (l.price_min == null) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: l.currency || "USD" }).format(n);
  return l.price_max != null && l.price_max !== l.price_min ? `${fmt(l.price_min)} – ${fmt(l.price_max)}` : fmt(l.price_min);
}

const badge = "rounded-full px-2 py-0.5 text-[11px] font-semibold";

/** Etsy Shop Manager'daki listing kartının karşılığı: görsel, başlık, stok/fiyat, istatistik, seçim ve işlem menüsü. */
export default function ListingCard({
  listing,
  selected,
  onSelectChange,
  onPublish,
  publishing,
  publishError,
}: {
  listing: Listing;
  selected: boolean;
  onSelectChange: (on: boolean) => void;
  onPublish: () => void;
  publishing: boolean;
  publishError?: string | null;
}) {
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

  const price = formatPrice(listing);
  const renews = listing.ending_timestamp
    ? new Date(listing.ending_timestamp * 1000).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const skus = (listing.skus ?? []).join(", ");

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-white dark:bg-neutral-900 ${
        selected ? "border-[#F1641E]" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <Link href={`/listings/${listing.listing_id}/edit`} className="relative block aspect-square bg-neutral-100 dark:bg-neutral-800">
        {listing.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.image_url} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {listing.has_local && <span className={`${badge} bg-amber-100 text-amber-800`}>Yayınlanmadı</span>}
          {listing.has_draft && <span className={`${badge} bg-neutral-200 text-neutral-700`}>Taslak</span>}
        </div>
        {listing.has_video && (
          <span className={`${badge} absolute bottom-2 left-2 bg-amber-300 text-neutral-900`}>Video</span>
        )}
      </Link>

      <div className="flex-1 space-y-1 p-3 text-xs text-neutral-500 dark:text-neutral-400">
        <Link
          href={`/listings/${listing.listing_id}/edit`}
          title={listing.title}
          className="block truncate text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
        >
          {listing.title}
        </Link>
        {listing.quantity != null && <p>{listing.quantity} stokta</p>}
        {skus && (
          <p className="truncate" title={skus}>
            {skus}
          </p>
        )}
        {price && <p className="text-[#1a7f4b] dark:text-green-400">{price}</p>}
        {renews && <p>{listing.should_auto_renew ? "Otomatik yenilenir" : "Sona erer"} {renews}</p>}
        <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <p className="text-[10px] font-semibold uppercase tracking-wide">İstatistikler</p>
          <p>
            {listing.views ?? 0} görüntülenme · {listing.favorites ?? 0} favori
          </p>
        </div>
        {publishError && <p className="text-red-600">{publishError}</p>}
      </div>

      <div className="flex items-center justify-between border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectChange(e.target.checked)}
          aria-label={`${listing.title} seç`}
          className="h-4 w-4 accent-[#F1641E]"
        />
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="İşlemler"
            className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ⚙ ▾
          </button>
          {menuOpen && (
            <div className="absolute bottom-full right-0 z-20 mb-1 w-48 overflow-hidden rounded-lg border border-neutral-200 bg-white text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <Link
                href={`/listings/${listing.listing_id}/edit`}
                className="block px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Düzenle
              </Link>
              {listing.has_local && (
                <button
                  type="button"
                  disabled={publishing}
                  onClick={() => {
                    setMenuOpen(false);
                    onPublish();
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800"
                >
                  {publishing ? "Yayınlanıyor…" : "Etsy'de yayınla"}
                </button>
              )}
              {listing.url && (
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  Etsy&apos;de görüntüle
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

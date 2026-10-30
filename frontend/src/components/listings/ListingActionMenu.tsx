"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Listing } from "@/lib/api";
import { useT } from "@/lib/i18n-client";

export type CardAction = "preview" | "stats" | "copy" | "activate" | "deactivate" | "renew" | "section" | "delete" | "publish";

/** Listing işlem menüsü (⚙): kart ve analiz tablosu AYNI menüyü kullanır. `up`: menü düğmenin üstünde açılır (kartın altındaki düğme için). */
export default function ListingActionMenu({
  listing,
  publishing,
  onAction,
  up = false,
}: {
  listing: Listing;
  publishing: boolean;
  onAction: (action: CardAction) => void;
  up?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const state = listing.state ?? "active";
  const item = (key: CardAction, label: string, danger = false, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        onAction(key);
      }}
      className={`block w-full px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800 ${danger ? "text-red-600" : ""}`}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("İşlemler", "Actions")}
        className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        ⚙ ▾
      </button>
      {open && (
        <div
          className={`absolute right-0 z-20 w-44 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900 sm:w-52 ${
            up ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {listing.url && !listing.is_new && (
            <a href={listing.url} target="_blank" rel="noreferrer" className="block px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800">
              {t("Etsy'de görüntüle ↗", "View on Etsy ↗")}
            </a>
          )}
          {item("preview", t("Önizle", "Preview"))}
          {!listing.is_new && item("stats", t("İstatistikleri gör", "View stats"))}
          <Link href={`/listings/${listing.listing_id}/edit`} className="block px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800">
            {t("Düzenle", "Edit")}
          </Link>
          {!listing.is_new && item("copy", t("Kopyala", "Copy"))}
          {listing.has_local &&
            item("publish", publishing ? t("Yayınlanıyor…", "Publishing…") : listing.is_new ? t("Etsy'de oluştur", "Create on Etsy") : t("Etsy'de yayınla", "Publish to Etsy"), false, publishing)}
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
  );
}

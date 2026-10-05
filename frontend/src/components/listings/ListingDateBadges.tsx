"use client";

import { useT } from "@/lib/i18n-client";

const RECENT_DAYS = 30;

type Kind = "updated" | "renewed";

/**
 * Listing'in iki ayrı tarihi: `updated` = kullanıcının Ulagg'dan Etsy'ye son yayını, `renewed` = Etsy'nin yenilemesi
 * (süre dolunca otomatik ya da satışla). Son 30 gündeyse renkli rozet, daha eskiyse sönük tarih.
 */
export function ListingDateBadge({ kind, timestamp }: { kind: Kind; timestamp?: number | null }) {
  const { t, locale } = useT();
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000);
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  const full = date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  const icon = kind === "updated" ? "✎" : "↻";
  const title =
    kind === "updated"
      ? t(`Ulagg'dan Etsy'ye son yayın: ${full}`, `Last published from Ulagg: ${full}`)
      : t(
          `Etsy'nin son yenilemesi: ${full} (süre dolunca otomatik ya da satış olunca)`,
          `Last renewed by Etsy: ${full} (automatically on expiry or after a sale)`,
        );

  if (days <= RECENT_DAYS) {
    const ago = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
    const label =
      kind === "updated"
        ? t(`${ago.charAt(0).toLocaleUpperCase(locale) + ago.slice(1)} güncellendi`, `Updated ${ago}`)
        : t(`Etsy yeniledi · ${ago}`, `Etsy renewed · ${ago}`);
    const tone =
      kind === "updated"
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        : "bg-[#D97757]/10 text-[#C6613F] dark:bg-[#D97757]/15 dark:text-[#E8A48A]";
    return (
      <span title={title} className={`rounded-full px-2 py-0.5 font-medium ${tone}`}>
        {icon} {label}
      </span>
    );
  }
  const short = date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return (
    <span title={title} className="text-neutral-400 dark:text-neutral-500">
      {icon}{" "}
      {kind === "updated" ? t(`Son güncelleme: ${short}`, `Updated ${short}`) : t(`Etsy yenileme: ${short}`, `Etsy renewed ${short}`)}
    </span>
  );
}

/** Liste satırı/kartı için iki tarih yan yana: önce kullanıcının güncellemesi, sonra Etsy'nin yenilemesi. */
export default function ListingDateBadges({ updated, renewed }: { updated?: number | null; renewed?: number | null }) {
  return (
    <>
      <ListingDateBadge kind="updated" timestamp={updated} />
      <ListingDateBadge kind="renewed" timestamp={renewed} />
    </>
  );
}

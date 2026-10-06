"use client";

import type { FadedInfo, TrackedRank } from "@/lib/api";
import { useState } from "react";
import { useT } from "@/lib/i18n-client";

const RECENT_DAYS = 30;

type Kind = "updated" | "renewed";

/**
 * Listing'in iki ayrı tarihi: `updated` = kullanıcının Ulagg'dan Etsy'ye son yayını, `renewed` = Etsy'nin yenilemesi
 * (süre dolunca otomatik ya da satışla). Son 30 gündeyse renkli rozet, daha eskiyse sönük tarih.
 */
export function ListingDateBadge({ kind, timestamp }: { kind: Kind; timestamp?: number | null }) {
  const { t, locale } = useT();
  const [now] = useState(() => Date.now());
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000);
  // Takvim günü farkı (geçen 24 saatlik dilim değil): dün akşamki yayın bu sabah "dün" görünmeli.
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((dayStart(new Date(now)) - dayStart(date)) / 86_400_000));
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

/** Sönmüş listing: eskiden satan ama uzun süredir satmayan. Gri rozet; üzerine gelince son satış ve toplam satış. */
export function FadedBadge({ info }: { info?: FadedInfo | null }) {
  const { t, locale } = useT();
  if (!info) return null;
  const years = Math.floor(info.days / 365);
  const months = Math.max(3, Math.floor(info.days / 30));
  const since =
    years >= 1
      ? t(`${years} yıldır satış yok`, `No sales for ${years} year${years > 1 ? "s" : ""}`)
      : t(`${months} aydır satış yok`, `No sales for ${months} months`);
  const last = new Date(`${info.last_sale}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  return (
    <span
      title={t(`Son satış: ${last} · toplam ${info.units} satış`, `Last sale: ${last} · ${info.units} sales in total`)}
      className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
    >
      ◌ {t("Sönmüş", "Faded")} · {since}
    </span>
  );
}

/**
 * Sıra takibindeki listing: en iyi aramadaki sırası ve 7 günlük değişimi. `onClick` verilirse düğme olur
 * (Analiz panelini Sıralama sekmesinde açar).
 */
export function RankBadge({ info, maxResults, onClick }: { info?: TrackedRank | null; maxResults: number; onClick?: () => void }) {
  const { t } = useT();
  if (!info) return null;
  const pos = info.position ? `#${info.position}` : `${maxResults}+`;
  const change = info.change_7d;
  const label = info.measured ? `${pos} · ${info.keyword}` : t("Sıra ölçümü bekliyor", "Ranking pending");
  const moveTr = change ? (change > 0 ? `, 7 günde ${change} sıra yükseldi` : `, 7 günde ${-change} sıra düştü`) : "";
  const moveEn = change ? (change > 0 ? `, up ${change} in 7 days` : `, down ${-change} in 7 days`) : "";
  const title = info.measured
    ? t(
        `Sıra takibinde (${info.keywords} arama). En iyi sırası: "${info.keyword}" aramasında ${pos}${moveTr}.`,
        `Rank tracking (${info.keywords} searches). Best position: ${pos} for "${info.keyword}"${moveEn}.`,
      )
    : t("Sıra takibinde; ilk ölçüm sabah yapılır.", "Rank tracking; the first measurement runs in the morning.");
  const body = (
    <>
      <span aria-hidden>📍</span>
      <span className="max-w-[14rem] truncate">{label}</span>
      {change ? (
        <span className={change > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
          {change > 0 ? `↑${change}` : `↓${-change}`}
        </span>
      ) : null}
    </>
  );
  const cls = "inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className={`${cls} hover:bg-sky-100 dark:hover:bg-sky-900/50`}>
      {body}
    </button>
  ) : (
    <span title={title} className={cls}>
      {body}
    </span>
  );
}

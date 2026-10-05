"use client";

import { useT } from "@/lib/i18n-client";

const RECENT_DAYS = 30;

/** Listing'in son yenilenme bilgisi: son 30 günde yenilendiyse vurgulu rozet, daha eskiyse sönük tarih. */
export default function RenewedBadge({ timestamp }: { timestamp?: number | null }) {
  const { t, locale } = useT();
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000);
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  const full = date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  const title = t(`Son yenileme: ${full}`, `Last renewed: ${full}`);

  if (days <= RECENT_DAYS) {
    const ago = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
    return (
      <span title={title} className="rounded-full bg-[#D97757]/10 px-2 py-0.5 font-medium text-[#C6613F] dark:bg-[#D97757]/15 dark:text-[#E8A48A]">
        ↻ {t(`${ago} yenilendi`, `Renewed ${ago}`)}
      </span>
    );
  }
  const short = date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return (
    <span title={title} className="text-neutral-400 dark:text-neutral-500">
      ↻ {t(`Son yenileme: ${short}`, `Renewed ${short}`)}
    </span>
  );
}

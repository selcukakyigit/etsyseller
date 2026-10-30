"use client";

import type { ReactNode } from "react";
import { countryShortName } from "@/lib/countries";
import type { DiscoverOverview } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import { monthNames } from "../SeasonChart";
import { compact } from "./Card";

const ICONS = {
  tag: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z",
  search: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z",
  globe:
    "M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418",
  calendar:
    "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5",
} as const;

function Stat({ icon, label, value, hint, onClick }: { icon: keyof typeof ICONS; label: string; value: ReactNode; hint?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#D97757]/10 text-[#C6613F] dark:text-[#E89A7F]">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={ICONS[icon]} />
          </svg>
        </span>
        {label}
      </span>
      <span className="mt-2 block truncate text-xl font-semibold text-neutral-900 dark:text-neutral-100">{value}</span>
      <span className="mt-0.5 block min-h-[1rem] truncate text-xs text-neutral-500 dark:text-neutral-400">{hint}</span>
    </>
  );
  const box = "block rounded-2xl border border-neutral-200 bg-white p-3.5 text-left shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${box} transition hover:border-[#D97757]`}>
      {body}
    </button>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** Üstteki dört özet kart: etiket sayısı, toplam Google araması, en çok arayan ülke, sıradaki sezon zirvesi. */
export default function PulseCards({ overview, onPick }: { overview: DiscoverOverview; onPick: (term: string) => void }) {
  const { t, locale } = useT();
  const names = monthNames(locale);
  const { pulse, countries } = overview;
  const top = countries.rows.find((r) => r.market === pulse.top_market);
  const peak = pulse.next_peak;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat icon="tag" label={t("Etiketlerin", "Your tags")} value={pulse.tags.toLocaleString(locale)} hint={t(`${pulse.measured.toLocaleString(locale)} tanesi ölçüldü`, `${pulse.measured.toLocaleString(locale)} measured`)} />
      <Stat
        icon="search"
        label={t("Aylık Google araması", "Monthly Google searches")}
        value={pulse.measured > 0 ? compact(pulse.monthly_searches, locale) : "—"}
        hint={t("etiketlerinin toplamı", "total across your tags")}
      />
      <Stat
        icon="globe"
        label={t("En çok arayan ülke", "Top searching country")}
        value={pulse.top_market ? countryShortName(pulse.top_market, locale) : "—"}
        hint={top ? t(`aramaların %${top.share}'i`, `${top.share}% of searches`) : t("ülke verisi hazırlanıyor", "country data is being prepared")}
      />
      <Stat
        icon="calendar"
        label={t("Sıradaki sezon", "Next season")}
        value={peak ? peak.term : "—"}
        hint={
          peak
            ? `${peak.peak_months.map((m) => names[m - 1]).join(", ")} · ${peak.in_months === 0 ? t("şimdi zirvede", "peaking now") : t(`${peak.in_months} ay sonra`, `in ${peak.in_months} month${peak.in_months === 1 ? "" : "s"}`)}`
            : t("sezonluk etiket yok", "no seasonal tags")
        }
        onClick={peak ? () => onPick(peak.term) : undefined}
      />
    </div>
  );
}

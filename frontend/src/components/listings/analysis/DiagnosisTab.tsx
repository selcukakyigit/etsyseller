"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ListingDiagnosis } from "@/lib/api";
import { useCached } from "@/lib/pageCache";
import { useT } from "@/lib/i18n-client";
import { BlockSpinner } from "@/components/ui/Spinner";
import HealthBanner from "./HealthBanner";

const TONE_DOT = {
  bad: "bg-red-500",
  good: "bg-emerald-500",
  info: "bg-neutral-400 dark:bg-neutral-500",
} as const;

const STATUS_STYLE: Record<ListingDiagnosis["status"], string> = {
  declining: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  growing: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  stable: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  new: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  low_data: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

/** Son 24 ayın satışı: koyu çubuk o ay, soluk çubuk geçen yılın aynı ayı (mevsim etkisini ayırt etmek için). */
function MonthlyBars({ months }: { months: ListingDiagnosis["months"] }) {
  const { t, locale } = useT();
  const max = Math.max(1, ...months.map((m) => Math.max(m.units, m.prev_year_units)));
  const label = (key: string) => new Date(`${key}-01T00:00:00`).toLocaleDateString(locale, { month: "short", year: "2-digit" });
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
        <span>{t("Aylık satış (adet)", "Monthly sales (units)")}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#D97757]" />{t("bu ay", "this month")}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-neutral-300 dark:bg-neutral-600" />{t("geçen yıl aynı ay", "same month last year")}</span>
        </span>
      </div>
      <div className="flex h-28 items-end gap-[3px]">
        {months.map((m) => (
          <div key={m.month} className="group relative flex h-full flex-1 items-end gap-px" title={`${label(m.month)}: ${m.units} · ${t("geçen yıl", "last year")} ${m.prev_year_units}`}>
            <div className="w-1/2 rounded-t-sm bg-neutral-300 dark:bg-neutral-600" style={{ height: `${(m.prev_year_units / max) * 100}%` }} />
            <div className="w-1/2 rounded-t-sm bg-[#D97757]" style={{ height: `${(m.units / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400 dark:text-neutral-500">
        <span>{months.length ? label(months[0].month) : ""}</span>
        <span>{months.length ? label(months[months.length - 1].month) : ""}</span>
      </div>
    </div>
  );
}

/** Teşhis sekmesi: listing'in durumu, neden düştüğü (kanıtlarla; son değişikliğin ölçülen sonucu da kanıttır), önerilen
 * tek hamle, huni sağlığı (durdurma önerisi dahil), mevsim ve olaylar. */
export default function DiagnosisTab({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t, locale } = useT();
  const [d, setD] = useCached<ListingDiagnosis>(`diagnosis:${shopId}:${listingId}`);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.insights
      .diagnosis(shopId, listingId)
      .then((r) => {
        if (!cancelled) {
          setD(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error && e.message ? e.message : t("Teşhis yüklenemedi", "Could not load the diagnosis"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, listingId, setD]);

  if (error && !d) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!d) return <BlockSpinner />;

  const seasonStyle =
    d.season.advice === "in_peak"
      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
      : d.season.advice === "prepare"
        ? "border-[#D97757]/40 bg-[#D97757]/10 text-[#B4553A] dark:text-[#E89A7F]"
        : "border-neutral-200 bg-white text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400";
  const confidence = d.confidence ? { high: t("güven: yüksek", "confidence: high"), medium: t("güven: orta", "confidence: medium"), low: t("güven: düşük", "confidence: low") }[d.confidence] : null;
  const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLE[d.status]}`}>{d.headline}</span>
        {confidence && <span className="text-xs text-neutral-500 dark:text-neutral-400">{confidence}</span>}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{t("Önerilen hamle", "Suggested move")}</p>
        <p className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">{d.action.text}</p>
        {["seo", "appeal", "conversion", "shop", "track"].includes(d.action.key) && (
          <Link
            href={`/listings/${listingId}/edit`}
            className="mt-3 inline-block rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#C6613F]"
          >
            {t("Düzenleyicide bu teşhisle AI önerisi üret →", "Generate an AI suggestion with this diagnosis →")}
          </Link>
        )}
      </div>

      <HealthBanner shopId={shopId} listingId={listingId} />

      {d.season.peak_months.length > 0 && <p className={`rounded-lg border px-3 py-2 text-xs ${seasonStyle}`}>{d.season.text}</p>}

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <MonthlyBars months={d.months} />
      </div>

      {d.evidence.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-neutral-400 dark:text-neutral-500">{t("Kanıtlar", "Evidence")}</p>
          <ul className="space-y-1.5">
            {d.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${TONE_DOT[e.tone]}`} />
                {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.events.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-neutral-400 dark:text-neutral-500">{t("Olaylar", "Events")}</p>
          <ul className="space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
            {d.events.map((e, i) => (
              <li key={i}>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">{fmtDate(e.date)}</span> · {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

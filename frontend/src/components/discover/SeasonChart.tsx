"use client";

import type { Season } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";

const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Takvim ayına göre 12 çubuk (Google Trends, 5 yıl ortalaması): hangi ay zirve. Profil hazırlanırken iskelet; çıkarılamadıysa hiçbir şey çizilmez.
 * Çubuk yüksekliği piksel olarak verilir (yüzde, üst kapta kesin yükseklik yoksa sıfıra düşer). */
export default function SeasonChart({ season, height = 56 }: { season: Season; height?: number }) {
  const { t, locale } = useT();
  const names = locale.startsWith("tr") ? MONTHS_TR : MONTHS_EN;
  if (season.pending && season.monthly.length === 0) {
    return <div data-testid="season-pending" className="mt-4 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" style={{ height: height + 28 }} aria-hidden />;
  }
  if (season.monthly.length !== 12) return null;
  const peaks = season.peak_months.map((m) => names[m - 1]);
  return (
    <div data-testid="season" className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {t("Mevsimsellik (Google Trends, 5 yıl)", "Seasonality (Google Trends, 5 years)")}
        {": "}
        <span className="font-medium text-neutral-800 dark:text-neutral-200">
          {season.seasonal ? t(`Zirve: ${peaks.join(", ")}`, `Peak: ${peaks.join(", ")}`) : t("Yıl boyu dengeli", "Steady all year")}
        </span>
      </p>
      <div className="mt-2 flex items-end gap-1.5" role="img" aria-label={t("Aylara göre göreli ilgi", "Relative interest by month")}>
        {season.monthly.map((value, i) => {
          const peak = season.seasonal && season.peak_months.includes(i + 1);
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${names[i]}: ${value}`}>
              <div className={`w-full rounded-sm ${peak ? "bg-[#D97757]" : "bg-neutral-300 dark:bg-neutral-600"}`} style={{ height: Math.max(2, Math.round((value / 100) * height)) }} />
              <span className={`text-[10px] leading-none ${peak ? "font-semibold text-neutral-700 dark:text-neutral-200" : "text-neutral-400"}`}>{names[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

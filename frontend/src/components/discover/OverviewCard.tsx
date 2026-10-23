"use client";

import type { DiscoverItem, Season } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import Sparkline from "./Sparkline";
import { useIntentLabel } from "./shared";

function Stat({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div title={hint}>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{children}</div>
    </div>
  );
}

const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Takvim ayına göre 12 çubuk (Google Trends, 5 yıl ortalaması): hangi ay zirve. Profil hazırlanırken iskelet, çıkarılamadıysa hiçbir şey gösterilmez. */
function SeasonStrip({ season }: { season: Season }) {
  const { t, locale } = useT();
  const names = locale.startsWith("tr") ? MONTHS_TR : MONTHS_EN;
  if (season.pending && season.monthly.length === 0) {
    return <div data-testid="season-pending" className="mt-4 h-16 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" aria-hidden />;
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
      <div className="mt-2 flex h-14 items-end gap-1" role="img" aria-label={t("Aylara göre göreli ilgi", "Relative interest by month")}>
        {season.monthly.map((value, i) => {
          const peak = season.seasonal && season.peak_months.includes(i + 1);
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`${names[i]}: ${value}`}>
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-sm ${peak ? "bg-[#D97757]" : "bg-neutral-300 dark:bg-neutral-600"}`}
                  style={{ height: `${Math.max(value, 3)}%` }}
                />
              </div>
              <span className="text-[10px] leading-none text-neutral-400">{names[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Aranan kelimenin özeti (Semrush'taki "Anahtar Kelime Genel Bakışı" gibi): aylık arama, CPC, rekabet, 12 aylık trend, niyet. Google verisidir. */
export default function OverviewCard({ item, selected, onToggle, onAnalyze, season }: { item: DiscoverItem; selected: boolean; onToggle: () => void; onAnalyze?: () => void; season?: Season | null }) {
  const { t, locale } = useT();
  const intentLabel = useIntentLabel();
  const intent = intentLabel(item.intent);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={item.term} className="h-4 w-4 accent-[#D97757]" />
          <span className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{item.term}</span>
        </label>
        {intent && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{intent}</span>}
        {item.mine && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">✓ {t("Sende var", "You use it")}</span>}
        {item.crowded && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">⚑ {t("Kalabalık", "Crowded")}</span>}
        {onAnalyze && (
          <button type="button" onClick={onAnalyze} className="ml-auto rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
            {t("Etsy'de rekabeti incele", "Inspect Etsy competition")}
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label={t("Aylık arama (Google)", "Monthly searches (Google)")} hint={t("Google verisi; Etsy arama hacmi değildir", "Google data; not Etsy search volume")}>
          {item.volume === null ? <span className="text-neutral-300 dark:text-neutral-600">…</span> : item.volume.toLocaleString(locale)}
        </Stat>
        <Stat label="CPC" hint={t("Google Ads tıklama başına ortalama maliyet", "Average Google Ads cost per click")}>
          {item.cpc === null ? "—" : `$${item.cpc.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </Stat>
        <Stat label={t("Reklam rekabeti", "Ad competition")} hint={t("0–100, Google Ads; Etsy rekabeti değildir", "0–100, Google Ads; not Etsy competition")}>
          {item.competition === null ? (
            "—"
          ) : (
            <span className="flex items-center gap-2">
              {item.competition}
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" aria-hidden>
                <span className="block h-full rounded-full bg-[#D97757]" style={{ width: `${item.competition}%` }} />
              </span>
            </span>
          )}
        </Stat>
        <Stat label={t("Trend (12 ay)", "Trend (12 months)")}>
          <span className="flex items-center gap-2">
            <Sparkline values={item.monthly} width={96} height={28} label={t("Son 12 ay aylık arama", "Monthly searches, last 12 months")} />
            {item.trend_pct !== null && (
              <span className={`text-sm ${item.trend_pct > 10 ? "text-green-600 dark:text-green-400" : item.trend_pct < -10 ? "text-red-500 dark:text-red-400" : "text-neutral-400"}`}>
                {item.trend_pct > 0 ? "+" : ""}
                {item.trend_pct}%
              </span>
            )}
          </span>
        </Stat>
      </div>
      {season && <SeasonStrip season={season} />}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import HelpTip from "@/components/ui/HelpTip";
import { DiscoverItem, Season, discoverApi } from "@/lib/discoverApi";
import { useT } from "@/lib/i18n-client";
import SeasonChart from "./SeasonChart";
import { useIntentLabel } from "./shared";

const POLL_MS = 2500;
const POLL_MAX = 24; // en çok ~1 dakika bekler; sonra "hazırlanıyor" yerine boş bırakılır
const BAR_HEIGHT = 80;

function Stat({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800" title={hint}>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{children}</div>
    </div>
  );
}

/** Bir kelimenin ayrıntısı (Keşfet listesinde kelimeye tıklayınca): son 12 ayın aylık arama grafiği, mevsimsellik (5 yıl, ayrı çekilir) ve Etsy rekabetine geçiş.
 * Tüm sayılar Google verisidir (Etsy arama hacmi değil). Pencere boyutu sabittir; mevsimsellik hazırlanırken yer tutucu aynı alanı kaplar. */
export default function KeywordDetailModal({ shopId, item, onClose, onAnalyze }: { shopId: number; item: DiscoverItem; onClose: () => void; onAnalyze?: (term: string) => void }) {
  const { t, locale } = useT();
  const intentLabel = useIntentLabel();
  const intent = intentLabel(item.intent);
  const [state, setState] = useState<{ term: string; season: Season | null; done: boolean } | null>(null);
  const term = item.term;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      discoverApi
        .season(shopId, term)
        .then((r) => {
          if (cancelled) return;
          const waiting = Boolean(r.season?.pending) && attempt < POLL_MAX;
          setState({ term, season: r.season, done: !waiting });
          if (waiting) timer = setTimeout(() => load(attempt + 1), POLL_MS);
        })
        .catch(() => !cancelled && setState({ term, season: null, done: true }));
    };
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [shopId, term]);

  const season = state && state.term === term ? state.season : null;
  const num = (n: number | null) => (n === null ? "—" : n.toLocaleString(locale));
  const max = Math.max(1, ...item.monthly);
  const peakAt = item.monthly.indexOf(Math.max(...item.monthly));

  return (
    <Modal title={term} widthClass="max-w-2xl" onClose={onClose} closeButton>
      <div className="min-h-[28rem] space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {intent && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{intent}</span>}
          {item.mine && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">✓ {t("Sende var", "You use it")}</span>}
          {item.crowded && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">⚑ {t("Kalabalık", "Crowded")}</span>}
          <span className="text-neutral-500 dark:text-neutral-400">{t("Google verisi (Etsy arama hacmi değil)", "Google data (not Etsy search volume)")}</span>
          <HelpTip>
            {t(
              "Aylık arama, CPC ve reklam rekabeti Google'dan gelir. Etsy'deki gerçek arama hacmini göstermez ama hangi kelimenin daha çok arandığını ve ne zaman arandığını anlamak için iyi bir göstergedir. Mevsimsellik, son 5 yılın aylara göre ortalamasıdır; en yüksek ay 100 kabul edilir.",
              "Monthly searches, CPC and ad competition come from Google. They are not Etsy's real search volume, but they show which words are searched more and when. Seasonality is the average of the last 5 years by calendar month; the highest month counts as 100.",
            )}
          </HelpTip>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t("Aylık arama", "Monthly searches")}>{num(item.volume)}</Stat>
          <Stat label="CPC">{item.cpc === null ? "—" : `$${item.cpc.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</Stat>
          <Stat label={t("Reklam rekabeti", "Ad competition")} hint={t("0–100, Google Ads", "0–100, Google Ads")}>{num(item.competition)}</Stat>
          <Stat label={t("Trend (12 ay)", "Trend (12 months)")} hint={t("Son 3 ay ilk 3 aya göre", "Last 3 months vs first 3")}>
            {item.trend_pct === null ? (
              "—"
            ) : (
              <span className={item.trend_pct > 10 ? "text-green-600 dark:text-green-400" : item.trend_pct < -10 ? "text-red-500 dark:text-red-400" : ""}>
                {item.trend_pct > 0 ? "+" : ""}
                {item.trend_pct}%
              </span>
            )}
          </Stat>
        </div>

        <div data-testid="monthly-chart">
          <h3 className="mb-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("Son 12 ayda aylık arama", "Monthly searches, last 12 months")}</h3>
          {item.monthly.length < 2 ? (
            <p className="rounded-lg bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-400 dark:bg-neutral-800/50 dark:text-neutral-500" style={{ minHeight: BAR_HEIGHT + 24 }}>
              {t("Aylık seri yok (çok az aranan kelime ya da ölçüm hazırlanıyor).", "No monthly series (a rarely searched word, or the measurement is still in progress).")}
            </p>
          ) : (
            <>
              <div className="flex items-end gap-1.5" role="img" aria-label={t("Son 12 ay aylık arama", "Monthly searches, last 12 months")}>
                {item.monthly.map((v, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1" title={v.toLocaleString(locale)}>
                    <span className="text-[10px] leading-none tabular-nums text-neutral-400">{i === peakAt ? v.toLocaleString(locale) : ""}</span>
                    <div className={`w-full rounded-sm ${i === peakAt ? "bg-[#D97757]" : "bg-neutral-300 dark:bg-neutral-600"}`} style={{ height: Math.max(2, Math.round((v / max) * BAR_HEIGHT)) }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
                <span>{t(`${item.monthly.length} ay önce`, `${item.monthly.length} months ago`)}</span>
                <span>{t("Son ay", "Latest month")}</span>
              </div>
            </>
          )}
        </div>

        <div style={{ minHeight: 120 }}>
          {season ? (
            <SeasonChart season={season} />
          ) : state?.done ? (
            <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
              {t("Mevsimsellik bu kelime için hesaplanamadı (çok az aranıyor olabilir).", "Seasonality could not be computed for this word (it may be searched too rarely).")}
            </p>
          ) : (
            <SeasonChart season={{ monthly: [], peak_months: [], seasonal: false, pending: true }} />
          )}
        </div>

        {onAnalyze && (
          <button
            type="button"
            onClick={() => onAnalyze(term)}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            {t("Etsy'de rekabeti incele", "Inspect Etsy competition")}
          </button>
        )}
      </div>
    </Modal>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api, ListingHistory, ListingPerformance } from "@/lib/api";
import TrendChart from "@/components/TrendChart";
import { T, useT } from "@/lib/i18n-client";
import { BlockSpinner } from "@/components/ui/Spinner";
import HelpTip from "@/components/ui/HelpTip";
import ChangeJourney from "./ChangeJourney";

// Oturum boyunca bellekte tutulan son sonuçlar: panel yeniden açılınca ya da dönem değişince eski veri anında görünür, arkada yenilenir.
const perfCache = new Map<string, ListingPerformance>();
const historyCache = new Map<string, ListingHistory>();

const RANGES = (t: T) => [
  { days: 7, label: t("7 gün", "7 days") },
  { days: 14, label: t("14 gün", "14 days") },
  { days: 30, label: t("30 gün", "30 days") },
  { days: 90, label: t("90 gün", "90 days") },
  { days: 365, label: t("1 yıl", "1 year") },
];
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Değişiklikler ve günlük görüntülenme/favori kayıtları aynı istekten gelir; oturum boyunca önbellekte durur. */
export function useListingHistory(shopId: number, listingId: number) {
  const { t } = useT();
  const [history, setHistory] = useState<ListingHistory | null>(historyCache.get(`${shopId}:${listingId}`) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listings
      .history(shopId, listingId)
      .then((h) => {
        historyCache.set(`${shopId}:${listingId}`, h);
        setHistory(h);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("Bilinmeyen hata", "Unknown error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, listingId]);

  return { history, error };
}

/** Seçilen dönemde satış (tam), görüntülenme/favori artışı (biriktirilen günlük kayıtlardan) ve dönüşüm.
 * `sinceDate`: listing'in son güncellemesinin tarihi; verilirse "Son güncellemeden beri" seçeneği çıkar ve varsayılan o olur
 * (önceki dönem arka uçta aynı uzunlukta, güncellemeden hemen önceki dönemdir: Önce / Sonra ölçümüyle aynı mantık). */
function PerformanceSummary({ shopId, listingId, sinceDate }: { shopId: number; listingId: number; sinceDate?: string }) {
  const { t, locale } = useT();
  const [choice, setChoice] = useState<number | "since" | null>(null);
  const mode: number | "since" = choice ?? (sinceDate ? "since" : 30);
  const [nowMs] = useState(() => Date.now());
  const sinceDays = sinceDate ? Math.max(1, Math.ceil((nowMs - new Date(sinceDate).getTime()) / 864e5)) : 0;
  const days = mode === "since" ? sinceDays || 30 : mode;
  const [perf, setPerf] = useState<ListingPerformance | null>(() => perfCache.get(`${shopId}:${listingId}:30`) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 864e5);
    api.listings
      .performance(shopId, listingId, isoDay(start), isoDay(end))
      .then((p) => {
        perfCache.set(`${shopId}:${listingId}:${days}`, p);
        if (!cancelled) {
          setPerf(p);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t("Performans yüklenemedi", "Performance could not be loaded"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, listingId, days]);

  const choose = (next: number | "since", nextDays: number) => {
    setChoice(next);
    const cached = perfCache.get(`${shopId}:${listingId}:${nextDays}`);
    if (cached) setPerf(cached);
  };
  const pill = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-xs ${active ? "bg-[#D97757] text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"}`;

  const pct = (a: number, b: number) => (b ? `${a >= b ? "▲" : "▼"} %${Math.abs(((a - b) / b) * 100).toFixed(0)}` : "");
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Dönem performansı", "Period performance")}</p>
        <div className="flex flex-wrap gap-1">
          {RANGES(t).slice(0, 4).map((r) => (
            <button key={r.days} type="button" onClick={() => choose(r.days, r.days)} className={pill(mode === r.days)}>
              {r.label}
            </button>
          ))}
          {sinceDate && (
            <button type="button" onClick={() => choose("since", sinceDays)} className={pill(mode === "since")}>
              {t("Son güncellemeden beri", "Since last update")}
            </button>
          )}
          {RANGES(t).slice(4).map((r) => (
            <button key={r.days} type="button" onClick={() => choose(r.days, r.days)} className={pill(mode === r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!perf && !error && <BlockSpinner />}
      {perf && !error && perf.freshness.tracking_days < days && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {t(
            `Bu dönem için görüntülenme verisi henüz tam değil: izleme ${perf.freshness.tracking_days} gündür. Satışlar sipariş geçmişinden tam gelir.`,
            `View data for this period is not complete yet: tracking has run for ${perf.freshness.tracking_days} days. Sales are complete from order history.`,
          )}
        </p>
      )}
      {perf && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{t("Satış adedi", "Units sold")}</div>
              <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{perf.sales.units}</div>
              <div className={`text-[11px] ${perf.sales.units >= perf.sales.prev_units ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {pct(perf.sales.units, perf.sales.prev_units)} <span className="text-neutral-400 dark:text-neutral-500">{t("önceki", "previous")} {perf.sales.prev_units}</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{t("Ciro", "Revenue")}</div>
              <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">${perf.sales.revenue.toLocaleString(locale, { maximumFractionDigits: 0 })}</div>
              <div className={`text-[11px] ${perf.sales.revenue >= perf.sales.prev_revenue ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{pct(perf.sales.revenue, perf.sales.prev_revenue)}</div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{t("Görüntülenme", "Views")}</div>
              <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{perf.views_now.available ? perf.views_now.views : "—"}</div>
              <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
                {perf.views_now.available
                  ? perf.views_now.partial
                    ? t(`izleme ${perf.views_now.tracking_started}'de başladı`, `tracking started ${perf.views_now.tracking_started}`)
                    : `${perf.views_now.favorites} ${t("favori", "favorites")}`
                  : t("geçmiş henüz yok", "no history yet")}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{t("Dönüşüm", "Conversion")}</div>
              <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{perf.conversion_percent !== null ? `%${perf.conversion_percent}` : "—"}</div>
              <div className="text-[11px] text-neutral-400 dark:text-neutral-500">{t("satış / görüntülenme", "sales / views")}</div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
            {t(
              `Satışlar sipariş geçmişinden tamdır. Etsy görüntülenme geçmişi vermez; günlük biriktiriyoruz (izleme ${perf.freshness.tracking_days} gündür). Toplam: ${perf.lifetime.views} görüntülenme, ${perf.lifetime.favorites} favori.`,
              `Sales are complete from order history. Etsy does not provide view history, so we collect it daily (tracking for ${perf.freshness.tracking_days} days). Total: ${perf.lifetime.views} views, ${perf.lifetime.favorites} favorites.`,
            )}
          </p>
        </>
      )}
    </div>
  );
}

/** Önce / Sonra sekmesi: dönem performansı, değişiklik işaretli grafikler ve her yayının ölçülen etkisi. */
export default function ChangesTab({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t } = useT();
  const { history, error } = useListingHistory(shopId, listingId);
  const [showAll, setShowAll] = useState(false);
  const changes = history?.changes ?? [];
  const events = changes.map((c) => ({ date: c.published_at }));
  return (
    <div className="space-y-4">
      {listingId > 0 && <PerformanceSummary shopId={shopId} listingId={listingId} sinceDate={changes[0]?.published_at} />}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!history && !error && <BlockSpinner />}
      {history && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TrendChart label={t("Görüntülenme", "Views")} color="views" data={history.stats.map((s) => ({ date: s.captured_at, value: s.views }))} events={events} />
            <TrendChart label={t("Favori", "Favorites")} color="favorites" data={history.stats.map((s) => ({ date: s.captured_at, value: s.favorites }))} events={events} />
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-400 dark:text-neutral-500">
              {t("Güncelleme yolculuğu", "Update journey")}
              <HelpTip>
                {t(
                  "Her güncelleme üç adımda izlenir: Güncelleme (ne değişti), Bekleme (yeterli veri birikene dek; ilk ölçüm 7. günde, kesin sonuç 30. günde) ve Değerlendirme. Değerlendirme aynı listing'in değişiklik öncesi ve sonrası dönemlerini, aynı dönemde hiç değiştirilmemiş benzer listing'lerle (kontrol grubu) karşılaştırır. Bu gerçek bir A/B testi değildir: iki sürüm aynı anda yarışmaz, mevsim etkisi kontrol grubuyla azaltılır. Bekleme sırasında başka değişiklik yapma.",
                  "Each update is followed in three steps: Update (what changed), Waiting (until enough data builds up; first reading on day 7, final result on day 30) and Evaluation. Evaluation compares the same listing before and after the change with similar listings that were not changed in the same period (control group). This is not a true A/B test: the two versions do not compete at the same time; seasonal effects are reduced with the control group. Avoid other changes while waiting.",
                )}
              </HelpTip>
            </p>
            {changes.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {t(
                  "Henüz kayıtlı bir değişiklik yok. Düzenleyip yayınladığında burada görünür; 7. günden itibaren etkisi ölçülür, 30. günde kesinleşir.",
                  "No recorded changes yet. When you edit and publish, it shows up here; its effect is measured from day 7 and becomes final at day 30.",
                )}
              </p>
            ) : (
              <>
                <ul className="space-y-2">
                  {(showAll ? changes : changes.slice(0, 4)).map((c) => (
                    <ChangeJourney key={c.id} ch={c} shopId={shopId} listingId={listingId} latest={c.id === changes[0]?.id} />
                  ))}
                </ul>
                {changes.length > 4 && (
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-medium text-[#B4553A] hover:underline dark:text-[#E89A7F]">
                    {showAll ? t("Daha az göster", "Show less") : t(`Daha fazla göster (${changes.length - 4} tane daha)`, `Show more (${changes.length - 4} more)`)}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

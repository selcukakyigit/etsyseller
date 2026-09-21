"use client";

import { useEffect, useState } from "react";
import { api, ListingHistory, ListingPerformance } from "@/lib/api";
import TrendChart from "@/components/TrendChart";

const STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  applied: "Uygulandı",
  dismissed: "Reddedildi",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Oturum boyunca bellekte tutulan son sonuçlar: panel yeniden açılınca ya da dönem değişince eski veri anında görünür, arkada yenilenir.
const perfCache = new Map<string, ListingPerformance>();
const historyCache = new Map<string, ListingHistory>();

const RANGES = [
  { days: 30, label: "30 gün" },
  { days: 90, label: "90 gün" },
  { days: 180, label: "180 gün" },
  { days: 365, label: "1 yıl" },
];
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Seçilen dönemde satış (tam), görüntülenme/favori artışı (biriktirilen günlük anlık görüntülerden) ve içerik güncelliği. */
function PerformanceSummary({ shopId, listingId }: { shopId: number; listingId: number }) {
  const [days, setDays] = useState(90);
  const [perf, setPerf] = useState<ListingPerformance | null>(() => perfCache.get(`${shopId}:${listingId}:90`) ?? null);
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
        if (!cancelled) setError(e instanceof Error ? e.message : "Performans yüklenemedi");
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, listingId, days]);

  const loading = !perf || perf.previous_period === undefined;
  const pct = (a: number, b: number) => (b ? `${a >= b ? "▲" : "▼"} %${Math.abs(((a - b) / b) * 100).toFixed(0)}` : "");
  const f = perf?.freshness;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-neutral-500">Performans</p>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => {
                setDays(r.days);
                const cached = perfCache.get(`${shopId}:${listingId}:${r.days}`);
                if (cached) setPerf(cached);
              }} className={`rounded-full px-2.5 py-1 text-xs ${days === r.days ? "bg-[#F1641E] text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {loading && !error && <p className="text-xs text-neutral-400">Yükleniyor…</p>}
      {perf && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-[11px] text-neutral-500">Satış adedi</div>
              <div className="text-lg font-semibold">{perf.sales.units}</div>
              <div className={`text-[11px] ${perf.sales.units >= perf.sales.prev_units ? "text-emerald-600" : "text-red-600"}`}>
                {pct(perf.sales.units, perf.sales.prev_units)} <span className="text-neutral-400">önceki {perf.sales.prev_units}</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">Ciro</div>
              <div className="text-lg font-semibold">${perf.sales.revenue.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</div>
              <div className={`text-[11px] ${perf.sales.revenue >= perf.sales.prev_revenue ? "text-emerald-600" : "text-red-600"}`}>{pct(perf.sales.revenue, perf.sales.prev_revenue)}</div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">Görüntülenme (dönem)</div>
              <div className="text-lg font-semibold">{perf.views_now.available ? perf.views_now.views : "—"}</div>
              <div className="text-[11px] text-neutral-400">{perf.views_now.available ? (perf.views_now.partial ? `izleme ${perf.views_now.tracking_started}'de başladı` : `${perf.views_now.favorites} favori`) : "geçmiş henüz yok"}</div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">İçerik güncelliği</div>
              <div className="text-lg font-semibold">{f?.days_since_content_change !== undefined ? `${f.days_since_content_change} gün` : f?.unchanged_for_at_least_days ? `≥ ${f.unchanged_for_at_least_days} gün` : "bilinmiyor"}</div>
              <div className="text-[11px] text-neutral-400">{f?.etsy_last_modified_days != null ? `Etsy son değişiklik: ${f.etsy_last_modified_days} gün önce` : ""}</div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">
            Satışlar sipariş geçmişinden tamdır. Etsy görüntülenme/favori geçmişi vermez; günlük biriktiriyoruz (izleme {f?.tracking_days ?? 0} gündür). Toplam: {perf.lifetime.views} görüntülenme, {perf.lifetime.favorites} favori
            {perf.conversion_percent !== null && ` · dönüşüm %${perf.conversion_percent}`}.
          </p>
        </>
      )}
    </div>
  );
}

export default function ListingHistoryPanel({
  shopId,
  listingId,
  initialHistory,
}: {
  shopId: number;
  listingId: number;
  /** Preview/test escape hatch: skip the network call and render this directly. */
  initialHistory?: ListingHistory;
}) {
  const [history, setHistory] = useState<ListingHistory | null>(initialHistory ?? historyCache.get(`${shopId}:${listingId}`) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialHistory) return;
    api.listings
      .history(shopId, listingId)
      .then((h) => {
        historyCache.set(`${shopId}:${listingId}`, h);
        setHistory(h);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Bilinmeyen hata"));
  }, [shopId, listingId, initialHistory]);

  // Performans ve geçmiş AYNI ANDA yüklenir (art arda değil); geçmiş gelene kadar performans kartı zaten görünür.
  if (error) return <p className="text-sm text-red-600 px-4 py-3">{error}</p>;
  if (!history)
    return (
      <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 p-4 space-y-4">
        {listingId > 0 && <PerformanceSummary shopId={shopId} listingId={listingId} />}
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Değişiklik geçmişi yükleniyor…</p>
      </div>
    );

  const appliedEvents = history.versions
    .filter((v) => v.status === "applied" && v.applied_at)
    .map((v) => ({ date: v.applied_at as string }));

  return (
    <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 p-4 space-y-4">
      {listingId > 0 && <PerformanceSummary shopId={shopId} listingId={listingId} />}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TrendChart
          label="Görüntülenme"
          color="views"
          data={history.stats.map((s) => ({ date: s.captured_at, value: s.views }))}
          events={appliedEvents}
        />
        <TrendChart
          label="Favori"
          color="favorites"
          data={history.stats.map((s) => ({ date: s.captured_at, value: s.favorites }))}
          events={appliedEvents}
        />
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-400 dark:text-neutral-500 mb-2">Değişiklik geçmişi</p>
        {history.versions.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Henüz bir öneri üretilmedi.</p>
        ) : (
          <ol className="space-y-2">
            {history.versions.map((v) => (
              <li key={v.id} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                    v.status === "applied"
                      ? "bg-green-50 text-green-600"
                      : v.status === "dismissed"
                        ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
                        : "bg-[#F1641E]/10 text-[#c94f16]"
                  }`}
                >
                  {STATUS_LABEL[v.status] ?? v.status}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-neutral-700 dark:text-neutral-300 truncate">{v.suggested_title}</p>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                    {formatDateTime(v.created_at)}
                    {v.applied_at && ` · uygulandı: ${formatDateTime(v.applied_at)}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

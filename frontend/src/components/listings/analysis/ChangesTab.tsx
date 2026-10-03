"use client";

import { useEffect, useState } from "react";
import { api, ChangeResult, ListingChange, ListingHistory, ListingPerformance } from "@/lib/api";
import TrendChart from "@/components/TrendChart";
import { T, useT } from "@/lib/i18n-client";
import { BlockSpinner } from "@/components/ui/Spinner";
import { fieldsText, metricText, sourceText, VERDICT_STYLE, verdictKey, verdictLabel } from "./changeLabels";

// Oturum boyunca bellekte tutulan son sonuçlar: panel yeniden açılınca ya da dönem değişince eski veri anında görünür, arkada yenilenir.
const perfCache = new Map<string, ListingPerformance>();
const historyCache = new Map<string, ListingHistory>();

const RANGES = (t: T) => [
  { days: 30, label: t("30 gün", "30 days") },
  { days: 90, label: t("90 gün", "90 days") },
  { days: 180, label: t("180 gün", "180 days") },
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

/** Seçilen dönemde satış (tam), görüntülenme/favori artışı (biriktirilen günlük kayıtlardan) ve dönüşüm. */
function PerformanceSummary({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t, locale } = useT();
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
        if (!cancelled) setError(e instanceof Error ? e.message : t("Performans yüklenemedi", "Performance could not be loaded"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, listingId, days]);

  const pct = (a: number, b: number) => (b ? `${a >= b ? "▲" : "▼"} %${Math.abs(((a - b) / b) * 100).toFixed(0)}` : "");
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("Dönem performansı", "Period performance")}</p>
        <div className="flex gap-1">
          {RANGES(t).map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => {
                setDays(r.days);
                const cached = perfCache.get(`${shopId}:${listingId}:${r.days}`);
                if (cached) setPerf(cached);
              }}
              className={`rounded-full px-2.5 py-1 text-xs ${days === r.days ? "bg-[#D97757] text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!perf && !error && <BlockSpinner />}
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

const signed = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v}%`);

function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-400 dark:text-neutral-500">—</span>;
  const cls = value > 0 ? "text-emerald-600 dark:text-emerald-400" : value < 0 ? "text-red-600 dark:text-red-400" : "text-neutral-600 dark:text-neutral-300";
  return <span className={cls}>{value > 0 ? "+" : ""}{value}%</span>;
}

/** Ölçüm ayrıntısı: önce/sonra sayıları, kontrol grubunun aynı dönemdeki değişimi ve net etki; takip edilen aramalardaki sıra. */
function ResultDetail({ r }: { r: Extract<ChangeResult, { status: "measured" }> }) {
  const { t } = useT();
  const rows = (["views", "favorites", "units"] as const).map((m) => ({ m, b: r.before[m], a: r.after[m], net: r.net[m] }));
  const pos = (p: number | null) => (p === null ? t("ilk 200'de yok", "not in top 200") : `#${Math.round(p)}`);
  return (
    <div className="mt-2 space-y-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] text-neutral-400 dark:text-neutral-500">
            <th className="py-1 font-normal" />
            <th className="py-1 font-normal">{t(`Önceki ${r.window_days} gün`, `${r.window_days} days before`)}</th>
            <th className="py-1 font-normal">{t(`Sonraki ${r.window_days} gün`, `${r.window_days} days after`)}</th>
            <th className="py-1 font-normal">{t("Kontrole göre", "Vs. control")}</th>
          </tr>
        </thead>
        <tbody className="text-neutral-700 dark:text-neutral-300">
          {rows.map(({ m, b, a, net }) => (
            <tr key={m} className={m === r.metric ? "font-semibold text-neutral-900 dark:text-neutral-100" : ""}>
              <td className="py-0.5 capitalize">{metricText(t, m)}</td>
              <td className="py-0.5">{b}</td>
              <td className="py-0.5">{a}</td>
              <td className="py-0.5"><Pct value={net} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
        {r.control.kind === "category"
          ? t(
              `Kontrol grubu: aynı kategoride, bu dönemde hiç değiştirilmemiş ${r.control.listings} listing. Onların görüntülenmesi aynı dönemde ${signed(r.control.views_pct)}.`,
              `Control group: ${r.control.listings} listings in the same category that were not changed in this period. Their views changed ${signed(r.control.views_pct)} over the same period.`,
            )
          : t(
              `Kontrol grubu: mağazada bu dönemde hiç değiştirilmemiş ${r.control.listings} listing (aynı kategoride yeterli listing yok). Onların görüntülenmesi aynı dönemde ${signed(r.control.views_pct)}.`,
              `Control group: ${r.control.listings} listings in the shop that were not changed in this period (not enough in the same category). Their views changed ${signed(r.control.views_pct)} over the same period.`,
            )}{" "}
        {t(
          `"Kontrole göre" sütunu mevsim ve mağaza geneli etkiyi çıkarır; karar kalın satıra göre verildi.`,
          `The "vs. control" column removes seasonal and shop-wide effects; the verdict is based on the bold row.`,
        )}{" "}
        {r.verdict === "unclear"
          ? t(
              "Fark büyük görünüyor ama bu kadar veriyle tesadüften ayırt edilemiyor; ölçüm devam ettikçe netleşebilir.",
              "The difference looks large, but with this much data it cannot be told apart from chance; it may become clear as measuring continues.",
            )
          : r.confidence
            ? t(
                `Bu farkın tesadüf olma ihtimali ${r.confidence === "high" ? "%1'in" : "%5'in"} altında.`,
                `The chance that this difference is random is below ${r.confidence === "high" ? "1%" : "5%"}.`,
              )
            : ""}
        {r.partial_window && !r.final && ` ${t("Ön sonuç; 30 güne tamamlanınca kesinleşir.", "Preliminary; it becomes final at 30 days.")}`}
      </p>
      {r.ranks.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{t("Arama sırası (ortalama)", "Search rank (average)")}</p>
          <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-700 dark:text-neutral-300">
            {r.ranks.map((k) => {
              const better = k.after !== null && (k.before === null || k.after < k.before);
              const worse = k.before !== null && (k.after === null || k.after > k.before);
              return (
                <li key={k.keyword}>
                  {k.keyword}: {pos(k.before)} →{" "}
                  <b className={better ? "text-emerald-600 dark:text-emerald-400" : worse ? "text-red-600 dark:text-red-400" : ""}>{pos(k.after)}</b>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChangeItem({ ch }: { ch: ListingChange }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const d = ch.details;
  const key = verdictKey(ch.result);
  const measured = ch.result?.status === "measured" ? ch.result : null;
  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {new Date(ch.published_at).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
        </span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{sourceText(t, ch.source)}</span>
        <span className="text-xs text-neutral-600 dark:text-neutral-400">{fieldsText(t, ch.fields)}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[key]}`}>{verdictLabel(t, ch.result)}</span>
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
        {d.title_before !== undefined && d.title_after !== undefined && (
          <p className="truncate">
            <span className="text-neutral-400 line-through dark:text-neutral-500">{d.title_before}</span> → {d.title_after}
          </p>
        )}
        {(d.tags_added?.length || d.tags_removed?.length) ? (
          <p>
            {d.tags_added?.length ? <span className="text-emerald-700 dark:text-emerald-400">+ {d.tags_added.join(", ")}</span> : null}
            {d.tags_added?.length && d.tags_removed?.length ? " · " : null}
            {d.tags_removed?.length ? <span className="text-red-700 dark:text-red-400">− {d.tags_removed.join(", ")}</span> : null}
          </p>
        ) : null}
        {d.price_before !== undefined && (
          <p>{t("Fiyat", "Price")}: {d.price_before ?? "—"} → {d.price_after ?? "—"}</p>
        )}
        {d.images_before !== undefined && (
          <p>
            {t("Fotoğraf", "Photos")}: {d.images_before} → {d.images_after}
            {d.thumbnail_changed && ` · ${t("kapak fotoğrafı değişti", "main photo changed")}`}
          </p>
        )}
      </div>
      {measured && measured.verdict !== "low_data" && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1.5 text-xs font-medium text-[#B4553A] hover:underline dark:text-[#E89A7F]">
          {open ? t("Ayrıntıyı gizle", "Hide details") : t("Nasıl ölçüldü?", "How was it measured?")}
        </button>
      )}
      {open && measured && <ResultDetail r={measured} />}
      {measured?.verdict === "low_data" && (
        <p className="mt-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
          {t(
            `Önce ve sonra toplam ${measured.before.views + measured.after.views} görüntülenme var; güvenilir bir karar için çok az.`,
            `Only ${measured.before.views + measured.after.views} views before and after combined; too few for a reliable verdict.`,
          )}
        </p>
      )}
    </li>
  );
}

/** Değişiklikler ve sonuçları: dönem performansı, değişiklik işaretli grafikler ve her yayının ölçülen etkisi. */
export default function ChangesTab({ shopId, listingId }: { shopId: number; listingId: number }) {
  const { t } = useT();
  const { history, error } = useListingHistory(shopId, listingId);
  const [showAll, setShowAll] = useState(false);
  const changes = history?.changes ?? [];
  const events = changes.map((c) => ({ date: c.published_at }));
  return (
    <div className="space-y-4">
      {listingId > 0 && <PerformanceSummary shopId={shopId} listingId={listingId} />}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!history && !error && <BlockSpinner />}
      {history && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TrendChart label={t("Görüntülenme", "Views")} color="views" data={history.stats.map((s) => ({ date: s.captured_at, value: s.views }))} events={events} />
            <TrendChart label={t("Favori", "Favorites")} color="favorites" data={history.stats.map((s) => ({ date: s.captured_at, value: s.favorites }))} events={events} />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-400 dark:text-neutral-500">{t("Yayınlanan değişiklikler", "Published changes")}</p>
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
                    <ChangeItem key={c.id} ch={c} />
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

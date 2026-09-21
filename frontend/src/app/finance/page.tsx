"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, FinReport, FinSyncStatus } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import AppShell from "@/components/AppShell";
import { CompareBars, StackedBars, monthLabel } from "@/components/finance/charts";
import { ProductCosts, OrderCosts } from "@/components/finance/CostEditors";

const names = new Intl.DisplayNames(["tr"], { type: "region", fallback: "code" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(period: string): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  if (period === "ytd") return { start: iso(new Date(y, 0, 1)), end: iso(now) };
  if (period === "last12") return { start: iso(new Date(y - 1, now.getMonth() + 1, 1)), end: iso(now) };
  if (period === "90d") return { start: iso(new Date(now.getTime() - 89 * 864e5)), end: iso(now) };
  if (period === "month") return { start: iso(new Date(y, now.getMonth(), 1)), end: iso(now) };
  const yr = Number(period);
  return { start: iso(new Date(yr, 0, 1)), end: iso(new Date(yr, 11, 31)) };
}

const card = "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
const h2 = "mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100";

function Delta({ cur, prev, label, invert = false }: { cur: number; prev: number; label: string; invert?: boolean }) {
  if (!prev) return <span className="text-xs text-neutral-400">{label} verisi yok</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const good = invert ? pct <= 0 : pct >= 0;
  return (
    <span className={`text-xs font-medium ${good ? "text-emerald-600" : "text-red-600"}`}>
      {pct >= 0 ? "▲" : "▼"} %{Math.abs(pct).toFixed(0)} <span className="font-normal text-neutral-400">{label} yılına göre</span>
    </span>
  );
}

export default function FinancePage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const shopId = activeShop?.id;
  const [tab, setTab] = useState<"overview" | "products" | "orders">("overview");
  const [period, setPeriod] = useState("ytd");
  const [country, setCountry] = useState("");
  const [report, setReport] = useState<FinReport | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [sync, setSync] = useState<FinSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [silentTick, setSilentTick] = useState(0); // maliyet girişinden sonra sessiz yenileme (ekran solmaz)
  const silentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (silentTimer.current) clearTimeout(silentTimer.current);
    silentTimer.current = setTimeout(() => setSilentTick((n) => n + 1), 1200);
  }, []);
  const autoStarted = useRef<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [orderQ, setOrderQ] = useState("");
  // Yalnızca aylık satış grafiği için 3 yıl seçici: "" = varsayılan (1. bu yıl, 2. geçen yıl, 3. yok), "none" = boş
  const [chartSel, setChartSel] = useState<string[]>(["", "", ""]);
  const [prodSort, setProdSort] = useState("sales");
  const wasRunning = useRef(false);

  const baseYear = Number(rangeFor(period).end.slice(0, 4));
  // Grafikte gösterilecek yıllar (en fazla 3, tekrarsız). Kartlar ve ülke çubukları her zaman bir önceki yılla karşılaştırılır.
  const chartYears = [
    chartSel[0] ? Number(chartSel[0]) : baseYear,
    chartSel[1] === "none" ? null : chartSel[1] ? Number(chartSel[1]) : baseYear - 1,
    chartSel[2] && chartSel[2] !== "none" ? Number(chartSel[2]) : null,
  ].filter((y, i, arr): y is number => y !== null && y <= baseYear && arr.indexOf(y) === i);
  const chartOffsets = chartYears.filter((y) => y < baseYear).map((y) => baseYear - y);
  const offsets = [1, ...chartOffsets.filter((o) => o !== 1)].slice(0, 4);
  const offsetsKey = offsets.join(",");
  const key = JSON.stringify([shopId, period, country, reloadTick, offsetsKey]);
  const loading = loadedKey !== key;

  useEffect(() => {
    if (shopId === undefined) return;
    const { start, end } = rangeFor(period);
    let cancelled = false;
    api.finance
      .report(shopId, start, end, country, offsetsKey.split(",").filter(Boolean).map(Number))
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setError(null);
        setLoadedKey(key);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, period, country, key, silentTick, offsetsKey]);

  // Senkronizasyon: ilk kullanımda otomatik başlar, çalışırken izlenir, bitince rapor yenilenir.
  const startSync = useCallback(
    (full = false) => {
      if (shopId === undefined) return;
      api.finance
        .sync(shopId, full)
        .then(setSync)
        .catch((e) => setError(String(e)));
    },
    [shopId],
  );
  useEffect(() => {
    if (shopId === undefined) return;
    let stop = false;
    const tick = () =>
      api.finance
        .syncStatus(shopId)
        .then((s) => {
          if (stop) return;
          setSync(s);
          if (wasRunning.current && !s.running) setReloadTick((n) => n + 1);
          wasRunning.current = s.running;
          if (!s.running && s.entries === 0 && autoStarted.current !== shopId) {
            autoStarted.current = shopId;
            startSync(false);
          }
        })
        .catch(() => {});
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [shopId, startSync]);

  const exportExcel = (all: boolean) => {
    if (shopId === undefined) return;
    const { start, end } = rangeFor(period);
    const scope = all ? "all" : tab;
    setExporting(true);
    api.finance
      .exportXlsx(shopId, start, end, country, { scope, q: all ? "" : orderQ, sort: prodSort })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `finans_${scope}_${start}_${end}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setExporting(false));
  };
  const tabLabel = { overview: "Genel bakış", products: "Ürünler", orders: "Siparişler" }[tab];

  const cur = report?.currency ?? "USD";
  const money = useMemo(() => new Intl.NumberFormat("tr-TR", { style: "currency", currency: cur, maximumFractionDigits: 0 }), [cur]);
  const money2 = useMemo(() => new Intl.NumberFormat("tr-TR", { style: "currency", currency: cur, maximumFractionDigits: 2 }), [cur]);
  const fmt = (n: number) => money.format(n);

  const years = useMemo(() => {
    const first = report?.first_year ?? new Date().getFullYear();
    const out: string[] = [];
    for (let y = new Date().getFullYear() - 1; y >= first; y--) out.push(String(y));
    return out;
  }, [report?.first_year]);

  const yearOptions: number[] = [];
  for (let y = baseYear; y >= (report?.first_year ?? baseYear - 1); y--) yearOptions.push(y);
  const cmpLabel = String(baseYear - 1);
  const PALETTE = ["#c4c4c4", "#93c5fd", "#a78bfa"];
  const chartSorted = [...chartYears].sort((a, b) => a - b); // eski yıl solda
  const others = chartYears.filter((y) => y !== baseYear).sort((a, b) => b - a); // en yakın yıl gri
  const compareSeries = chartSorted.map((y) => ({ name: String(y), color: y === baseYear ? "#F1641E" : PALETTE[others.indexOf(y)] ?? PALETTE[2] }));
  const k = report?.kpi;
  const pk = report?.prev_kpi;
  const missingFees = report?.coverage.orders_without_fees ?? 0;
  const select = "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/finance">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {!user && !bootError && <p className="text-sm text-neutral-400">Yükleniyor…</p>}
        {(bootError || error) && <p className="mb-4 text-sm text-red-600">{bootError ?? error}</p>}

        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Finans</h1>
            <p className="text-sm text-neutral-500">Satış, Etsy ücretleri ve ürün kârlılığı. Tutarlar {cur} cinsindendir.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className={select}>
              <option value="ytd">Bu yıl</option>
              <option value="month">Bu ay</option>
              <option value="90d">Son 90 gün</option>
              <option value="last12">Son 12 ay</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={select}>
              <option value="">Tüm ülkeler</option>
              {(report?.available_countries ?? []).map((c) => (
                <option key={c} value={c}>
                  {names.of(c) ?? c}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={exporting || !report}
              onClick={() => exportExcel(false)}
              title="Bu sekmedeki dönem, ülke ve filtrelerle"
              className="rounded-lg bg-[#F1641E] px-3 py-2 text-sm font-medium text-white hover:bg-[#d9560f] disabled:opacity-50"
            >
              {exporting ? "Hazırlanıyor…" : `Excel: ${tabLabel}`}
            </button>
            <button
              type="button"
              disabled={exporting || !report}
              onClick={() => exportExcel(true)}
              title="Tüm sayfalar (özet, müşteriler, ülkeler, ürünler, siparişler), dönem ve ülke filtresiyle"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Tümünü aktar
            </button>
            <button
              type="button"
              disabled={sync?.running}
              onClick={() => startSync(false)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {sync?.running ? "Güncelleniyor…" : "Etsy'den güncelle"}
            </button>
          </div>
        </div>

        {sync?.running && (
          <div className="mb-5 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200">
            {sync.phase || "Etsy hesap hareketleri indiriliyor"} · %{Math.round(sync.progress * 100)}
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-orange-200 dark:bg-orange-900">
              <div className="h-full bg-[#F1641E] transition-all" style={{ width: `${Math.round(sync.progress * 100)}%` }} />
            </div>
          </div>
        )}
        {sync?.error && <p className="mb-4 text-sm text-red-600">Senkronizasyon hatası: {sync.error}</p>}
        {!sync?.running && missingFees > 0 && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Bu dönemdeki {missingFees} siparişin Etsy ücret kaydı yok; bu siparişlerde ücretler 0 görünür. &quot;Etsy&apos;den güncelle&quot; ile tamamlanır.
          </p>
        )}

        <div className="mb-5 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
          {(
            [
              ["overview", "Genel bakış"],
              ["products", "Ürün kârlılığı"],
              ["orders", "Sipariş maliyetleri"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === v ? "border-[#F1641E] text-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {!report && !error && <p className="text-sm text-neutral-400">Rapor hazırlanıyor…</p>}

        {report && k && pk && (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {tab === "overview" && (
              <div className="space-y-5">
                <section className={card}>
                  <h2 className={h2}>En çok alışveriş yapan müşteriler</h2>
                  {report.customers.length === 0 ? (
                    <p className="text-sm text-neutral-400">Bu dönemde sipariş yok.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800">
                            <th className="py-2 pr-3 font-medium">#</th>
                            <th className="py-2 pr-3 font-medium">Müşteri</th>
                            <th className="py-2 pr-3 font-medium">Ülke</th>
                            <th className="py-2 pr-3 text-right font-medium">Sipariş</th>
                            <th className="py-2 pr-3 text-right font-medium">Toplam</th>
                            <th className="py-2 text-right font-medium">Son sipariş</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.customers.slice(0, 10).map((c, i) => (
                            <tr key={`${c.name}-${i}`} className="border-b border-neutral-50 last:border-0 dark:border-neutral-800/60">
                              <td className="py-2 pr-3 text-neutral-400">{i + 1}</td>
                              <td className="py-2 pr-3 font-medium">{c.name}</td>
                              <td className="py-2 pr-3 text-neutral-500">{c.country ? (names.of(c.country) ?? c.country) : "—"}</td>
                              <td className="py-2 pr-3 text-right">{c.orders}</td>
                              <td className="py-2 pr-3 text-right font-medium">{money2.format(c.sales)}</td>
                              <td className="py-2 text-right text-neutral-500">{c.last}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <Kpi label="Satış (vergi hariç)" value={fmt(k.sales)} sub={<Delta label={cmpLabel} cur={k.sales} prev={pk.sales} />} extra={`${k.orders} sipariş`} />
                  <Kpi
                    label="Etsy ücretleri"
                    value={fmt(k.fees + k.overhead)}
                    sub={<Delta label={cmpLabel} cur={k.fees + k.overhead} prev={pk.fees + pk.overhead} invert />}
                    extra={`Sipariş ${fmt(k.fees)} · Reklam/diğer ${fmt(k.overhead)}`}
                  />
                  <Kpi
                    label="Ürün + kargo maliyeti"
                    value={fmt(k.cogs)}
                    sub={k.cogs === 0 ? <span className="text-xs text-amber-600">Maliyet girilmemiş</span> : <Delta label={cmpLabel} cur={k.cogs} prev={pk.cogs} invert />}
                    extra="Ürün kârlılığı sekmesinden girilir"
                  />
                  <Kpi label="Net kâr" value={fmt(k.profit)} sub={<Delta label={cmpLabel} cur={k.profit} prev={pk.profit} />} highlight />
                  <Kpi label="Kâr marjı" value={`%${k.margin.toFixed(1)}`} sub={<span className="text-xs text-neutral-400">{cmpLabel}: %{pk.margin.toFixed(1)}</span>} />
                  <Kpi label="İadeler" value={fmt(k.refunds)} sub={<Delta label={cmpLabel} cur={k.refunds} prev={pk.refunds} invert />} />
                </section>

                <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Metric label="Ortalama sipariş değeri" value={money2.format(k.aov)} sub={<Delta label={cmpLabel} cur={k.aov} prev={pk.aov} />} />
                  <Metric
                    label="Etsy'ye giden pay"
                    value={`%${k.etsy_share.toFixed(1)}`}
                    hint="Sipariş ücretleri + reklam + yenileme, satışa oranı"
                    sub={<span className="text-xs text-neutral-400">{cmpLabel}: %{pk.etsy_share.toFixed(1)}</span>}
                  />
                  <Metric
                    label="Reklam harcaması"
                    value={fmt(k.ads)}
                    hint="Etsy Ads gideri; satışa oranı"
                    sub={<span className="text-xs text-neutral-400">satışın %{k.ads_pct.toFixed(1)}&apos;i · {cmpLabel}: %{pk.ads_pct.toFixed(1)}</span>}
                  />
                  <Metric
                    label="İade + iptal oranı"
                    value={`%${k.problem_pct.toFixed(1)}`}
                    hint={`${k.canceled} iptal, ${k.refunded_orders} iadeli sipariş / ${k.all_orders} sipariş`}
                    sub={<span className="text-xs text-neutral-400">{cmpLabel}: %{pk.problem_pct.toFixed(1)}</span>}
                  />
                </section>

                <section className={card}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Aylık satış karşılaştırması</h2>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                      Yıllar
                      {[0, 1, 2].map((slot) => {
                        const value = chartSel[slot] || (slot === 0 ? String(baseYear) : slot === 1 ? String(baseYear - 1) : "none");
                        return (
                          <select
                            key={slot}
                            value={value}
                            onChange={(e) => setChartSel((prev) => prev.map((v, i) => (i === slot ? e.target.value : v)))}
                            className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                          >
                            {slot > 0 && <option value="none">— yok —</option>}
                            {yearOptions.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        );
                      })}
                    </div>
                  </div>
                  <CompareBars
                    data={report.series.map((sp) => ({
                      label: monthLabel(sp.month).slice(0, 3),
                      values: chartSorted.map((y) =>
                        y === baseYear ? sp.sales : baseYear - y === report.offsets[0] ? sp.prev_sales : (sp.cmp.find((c) => c.offset === baseYear - y)?.sales ?? 0),
                      ),
                    }))}
                    series={compareSeries}
                    fmt={fmt}
                  />
                </section>

                <section className={card}>
                  <h2 className={h2}>Satış nereye gidiyor?</h2>
                  <StackedBars
                    data={report.series.map((s) => ({ label: monthLabel(s.month), parts: [s.profit, s.cogs, s.fees, s.overhead] }))}
                    legend={[
                      { name: "Net kâr", color: "#10b981" },
                      { name: "Ürün + kargo", color: "#6366f1" },
                      { name: "Sipariş ücretleri", color: "#F1641E" },
                      { name: "Reklam / diğer", color: "#f59e0b" },
                    ]}
                    fmt={fmt}
                  />
                  <div className="mt-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                    {[...Object.entries(k.fee_types), ...Object.entries(k.overhead_types)].map(([n, v]) => (
                      <div key={n} className="flex justify-between border-b border-neutral-100 py-1 dark:border-neutral-800">
                        <span className="text-neutral-600 dark:text-neutral-300">{n}</span>
                        <span className="font-medium">{money2.format(v)}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={card}>
                  <h2 className={h2}>Hangi ülkeye satış yapıldı?</h2>
                  <CountryBars rows={report.countries} fmt={fmt} cur={String(baseYear)} prev={cmpLabel} />
                </section>
              </div>
            )}

            {tab === "products" && shopId !== undefined && (
              <ProductCosts products={report.products} shopId={shopId} money2={money2} onSaved={scheduleRefresh} onSortChange={setProdSort} />
            )}
            {tab === "orders" && shopId !== undefined && (
              <OrderCosts shopId={shopId} range={rangeFor(period)} money2={money2} onSaved={scheduleRefresh} onQuery={setOrderQ} />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, sub, extra, highlight }: { label: string; value: string; sub?: React.ReactNode; extra?: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-4 ${highlight ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950" : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"}`}
    >
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
      <div className="mt-1">{sub}</div>
      {extra && <div className="mt-1 text-[11px] text-neutral-400">{extra}</div>}
    </div>
  );
}

function Metric({ label, value, sub, hint }: { label: string; value: string; sub?: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900" title={hint}>
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
      <div className="mt-0.5">{sub}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-tight text-neutral-400">{hint}</div>}
    </div>
  );
}

function CountryBars({ rows, fmt, cur, prev }: { rows: FinReport["countries"]; fmt: (n: number) => string; cur: string; prev: string }) {
  const max = Math.max(...rows.flatMap((r) => [r.sales, r.prev_sales]), 1);
  if (rows.length === 0) return <p className="text-sm text-neutral-400">Bu dönemde sipariş yok.</p>;
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-xs text-neutral-600 dark:text-neutral-300">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#F1641E]" />
          {cur}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-neutral-300" />
          {prev}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.iso} className="grid grid-cols-[7rem_1fr_9rem] items-center gap-3 text-sm">
          <span className="truncate font-medium">{r.iso === "??" ? "Bilinmiyor" : (names.of(r.iso) ?? r.iso)}</span>
          <div className="space-y-1">
            <div className="h-2.5 rounded bg-[#F1641E]" style={{ width: `${(r.sales / max) * 100}%` }} />
            <div className="h-2.5 rounded bg-neutral-300 dark:bg-neutral-600" style={{ width: `${(r.prev_sales / max) * 100}%` }} />
          </div>
          <span className="text-right text-xs text-neutral-500">
            <b className="text-neutral-900 dark:text-neutral-100">{fmt(r.sales)}</b> · {r.orders} sip.
            <br />
            {prev}: {fmt(r.prev_sales)}
          </span>
        </div>
      ))}
    </div>
  );
}

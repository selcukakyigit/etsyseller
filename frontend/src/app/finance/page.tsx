"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, FinReport, FinSyncStatus } from "@/lib/api";
import { useAuthAndShop } from "@/lib/useAuthAndShop";
import { useUrlTab } from "@/lib/useUrlTab";
import AppShell from "@/components/AppShell";
import { CompareBars, StackedBars, monthLabel } from "@/components/finance/charts";
import { ProductCosts, OrderCosts } from "@/components/finance/CostEditors";
import ShippingInvoices from "@/components/finance/ShippingInvoices";
import { onSyncDone } from "@/lib/syncEvents";
import TopOrders from "@/components/finance/TopOrders";
import { tNow, useT } from "@/lib/i18n-client";
import { PageSpinner } from "@/components/ui/Spinner";
import { Popover, menuBox, menuItem } from "@/components/ui/Popover";
import { useStoredState } from "@/lib/useStoredState";
import DateRangePicker, { CUSTOM, RangeOption, presetOptions } from "@/components/ui/DateRangePicker";
import { presetRange, yearRange } from "@/lib/dateRanges";

const regionNames: Record<string, Intl.DisplayNames> = {};
const countryOf = (code: string) => {
  const lang = tNow("tr", "en");
  return (regionNames[lang] ??= new Intl.DisplayNames([lang], { type: "region", fallback: "code" })).of(code) ?? code;
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(period: string): { start: string; end: string } {
  return presetRange(period) ?? yearRange(Number(period));
}

const TABS = ["overview", "products", "orders", "invoices"] as const;

const card = "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
const h2 = "mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100";

function Delta({ cur, prev, label, invert = false }: { cur: number; prev: number; label: string; invert?: boolean }) {
  if (!prev) return <span className="text-xs text-neutral-400">{tNow(`${label} verisi yok`, `no ${label} data`)}</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const good = invert ? pct <= 0 : pct >= 0;
  return (
    <span className={`text-xs font-medium ${good ? "text-emerald-600" : "text-red-600"}`}>
      {pct >= 0 ? "▲" : "▼"} %{Math.abs(pct).toFixed(0)} <span className="font-normal text-neutral-400">{tNow(`${label} yılına göre`, `vs ${label}`)}</span>
    </span>
  );
}

export default function FinancePage() {
  const { user, shops, activeShop, setActiveShopId, error: bootError } = useAuthAndShop();
  const { t, locale } = useT();
  const shopId = activeShop?.id;
  const isDemo = !!activeShop?.is_demo; // demo mağaza Etsy'ye bağlanmaz: finans senkronu başlatılmaz
  const [tab, setTab] = useUrlTab<(typeof TABS)[number]>("tab", "overview", TABS);
  const [topTab, setTopTab] = useState<"customers" | "best" | "worst">("customers");
  // Dönem, özel tarih aralığı ve ülke seçimi bu tarayıcıda hatırlanır (sayfaya dönünce ya da yenileyince aynı kalır).
  const [defaultStart] = useState(() => iso(new Date(Date.now() - 29 * 864e5)));
  const [defaultEnd] = useState(() => iso(new Date()));
  const [period, setPeriod] = useStoredState<string>("finance.period", "month");
  const [customStart, setCustomStart] = useStoredState<string>("finance.customStart", defaultStart);
  const [customEnd, setCustomEnd] = useStoredState<string>("finance.customEnd", defaultEnd);
  const [country, setCountry] = useStoredState<string>("finance.country", "");
  const [report, setReport] = useState<FinReport | null>(null);
  // period built-in bir seçenekse rangeFor'dan, "custom" ise kullanıcının seçtiği iki tarihten, "all" ise ilk
  // siparişten bugüne (henüz veri gelmediyse Etsy'nin kuruluş yılı 2005 güvenli bir alt sınır) gelir;
  // Genel bakış/Ürünler/Siparişler hepsi tek bu değeri kullanır, ayrı bir entegrasyon gerekmez.
  const range =
    period === "custom"
      ? { start: customStart, end: customEnd }
      : period === "all"
        ? { start: iso(new Date(report?.first_year ?? 2005, 0, 1)), end: iso(new Date()) }
        : rangeFor(period);
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

  const baseYear = Number(range.end.slice(0, 4));
  // Grafikte gösterilecek yıllar (en fazla 3, tekrarsız). Kartlar ve ülke çubukları her zaman bir önceki yılla karşılaştırılır.
  const chartYears = [
    chartSel[0] ? Number(chartSel[0]) : baseYear,
    chartSel[1] === "none" ? null : chartSel[1] ? Number(chartSel[1]) : baseYear - 1,
    chartSel[2] && chartSel[2] !== "none" ? Number(chartSel[2]) : null,
  ].filter((y, i, arr): y is number => y !== null && y <= baseYear && arr.indexOf(y) === i);
  const chartOffsets = chartYears.filter((y) => y < baseYear).map((y) => baseYear - y);
  const offsets = [1, ...chartOffsets.filter((o) => o !== 1)].slice(0, 4);
  const offsetsKey = offsets.join(",");
  const key = JSON.stringify([shopId, period, range.start, range.end, country, reloadTick, offsetsKey]);
  const loading = loadedKey !== key;

  useEffect(() => {
    if (shopId === undefined) return;
    if (period === "custom" && customStart > customEnd) return; // geçersiz aralık: bekle, istek atma

    const storageKey = `fin-report:${key}`;
    let cancelled = false;
    api.finance
      .report(shopId, range.start, range.end, country, offsetsKey.split(",").filter(Boolean).map(Number))
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setError(null);
        setLoadedKey(key);
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(r));
        } catch {
          // kota dolu vb. — önbellek olmadan da çalışır
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, key, silentTick, period, range.start, range.end, country, offsetsKey, customStart, customEnd]);

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
          if (!s.running && s.entries === 0 && autoStarted.current !== shopId && !isDemo) {
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
  }, [shopId, startSync, isDemo]);

  // Tek "senkronize et" düğmesi navbar'da; o bitince rapor kendiliğinden tazelenir.
  useEffect(() => onSyncDone(() => setReloadTick((n) => n + 1)), []);

  const exportExcel = (all: boolean) => {
    if (shopId === undefined) return;
    const { start, end } = range;
    const scope = all ? "all" : tab === "invoices" ? "products" : tab;
    setExporting(true);
    api.finance
      .exportXlsx(shopId, start, end, country, { scope, q: all ? "" : orderQ, sort: prodSort })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${t("finans", "finance")}_${scope}_${start}_${end}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setExporting(false));
  };
  const tabLabel = { overview: t("Genel bakış", "Overview"), products: t("Ürünler", "Products"), orders: t("Siparişler", "Orders"), invoices: t("Ürünler", "Products") }[tab];

  // Aynı dönem/ülke için daha önce yüklenmiş bir rapor sessionStorage'daysa (ör. sayfadan çıkıp geri gelince)
  // taze veri gelene kadar onu gösterir — "Rapor hazırlanıyor…" boşluğu ve ardından gelen ani UI değişimi yerine.
  const displayReport = useMemo<FinReport | null>(() => {
    if (report) return report;
    try {
      const cached = sessionStorage.getItem(`fin-report:${key}`);
      return cached ? (JSON.parse(cached) as FinReport) : null;
    } catch {
      return null;
    }
  }, [report, key]);

  const cur = displayReport?.currency ?? "USD";
  const money = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: cur, maximumFractionDigits: 0 }), [cur, locale]);
  const money2 = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: cur, maximumFractionDigits: 2 }), [cur, locale]);
  const fmt = (n: number) => money.format(n);

  const years = useMemo(() => {
    const first = displayReport?.first_year ?? new Date().getFullYear();
    const out: string[] = [];
    for (let y = new Date().getFullYear() - 1; y >= first; y--) out.push(String(y));
    return out;
  }, [displayReport?.first_year]);

  // Dönem seçenekleri: hazır dönemler, geçmiş yıllar ve tüm zamanlar (aralığı ilk siparişten bugüne, `range` hesaplar).
  const periodOptions: RangeOption[] = [
    ...presetOptions(["today", "yesterday", "month", "last_month", "7d", "30d", "90d", "ytd", "last12"], t),
    ...years.map((y) => ({ id: y, label: y, range: yearRange(Number(y)) })),
    { id: "all", label: t("Tüm zamanlar", "All time"), range: null },
  ];

  const yearOptions: number[] = [];
  for (let y = baseYear; y >= (displayReport?.first_year ?? baseYear - 1); y--) yearOptions.push(y);
  const cmpLabel = String(baseYear - 1);
  const PALETTE = ["#c4c4c4", "#93c5fd", "#a78bfa"];
  const chartSorted = [...chartYears].sort((a, b) => a - b); // eski yıl solda
  const others = chartYears.filter((y) => y !== baseYear).sort((a, b) => b - a); // en yakın yıl gri
  const compareSeries = chartSorted.map((y) => ({ name: String(y), color: y === baseYear ? "#D97757" : PALETTE[others.indexOf(y)] ?? PALETTE[2] }));
  const k = displayReport?.kpi;
  const pk = displayReport?.prev_kpi;
  const missingFees = displayReport?.coverage.orders_without_fees ?? 0;
  const select = "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <AppShell user={user} shops={shops} activeShop={activeShop} onSwitchShop={setActiveShopId} current="/finance">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-8 pt-0">
        {/* Sabit yükseklik: bu satır `user` gelince DOM'dan tamamen kalkıyor — sarmalayıcı olmadan
            altındaki başlık/filtre satırı bir anda yukarı kayıyordu ("UI zıplaması"). */}
        <div>
          {!user && !bootError && <PageSpinner />}
        </div>
        {(bootError || error) && <p className="mb-4 text-sm text-red-600">{bootError ?? error}</p>}

        <div className={`mb-5 ${!displayReport && !error ? "min-h-[52px]" : ""}`}>
          {sync?.running && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200">
              {sync.phase || t("Etsy hesap hareketleri indiriliyor", "Downloading Etsy account activity")} · %{Math.round(sync.progress * 100)}
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-orange-200 dark:bg-orange-900">
                <div className="h-full bg-[#D97757] transition-all" style={{ width: `${Math.round(sync.progress * 100)}%` }} />
              </div>
            </div>
          )}
          {sync?.error && !isDemo && <p className="text-sm text-red-600">{t("Senkronizasyon hatası", "Sync error")}: {sync.error}</p>}
          {!sync?.running && !sync?.error && missingFees > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {t(
                `Bu dönemdeki ${missingFees} siparişin Etsy ücret kaydı yok; bu siparişlerde ücretler 0 görünür. Üstteki senkronize ikonuyla tamamlanır.`,
                `${missingFees} orders in this period have no Etsy fee records yet, so their fees show as 0. The sync icon at the top fills them in.`,
              )}
            </p>
          )}
        </div>

        <div className="z-[9] -mx-4 lg:sticky lg:top-[49px] sm:-mx-6 bg-neutral-50 px-4 sm:px-6 pb-3 pt-3 dark:bg-neutral-950">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("Finans", "Finance")}</h1>
          <Popover
            label={t("Excel'e aktar", "Export to Excel")}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#D97757] px-3.5 text-sm font-medium text-white hover:bg-[#C6613F] disabled:opacity-50"
            button={exporting ? t("Hazırlanıyor…", "Preparing…") : <>{t("Excel", "Excel")} ▾</>}
          >
            {(close) => (
              <div role="menu" className={`${menuBox} w-64`}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={exporting || !displayReport}
                  onClick={() => {
                    close();
                    void exportExcel(false);
                  }}
                  className={`${menuItem} disabled:opacity-50`}
                >
                  <span>
                    <span className="block">{t(`Bu sekme: ${tabLabel}`, `This tab: ${tabLabel}`)}</span>
                    <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">{t("Dönem, ülke ve filtrelerle", "With the period, country and filters")}</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={exporting || !displayReport}
                  onClick={() => {
                    close();
                    void exportExcel(true);
                  }}
                  className={`${menuItem} disabled:opacity-50`}
                >
                  <span>
                    <span className="block">{t("Tümünü aktar", "Export all")}</span>
                    <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">{t("Özet, müşteriler, ülkeler, ürünler, siparişler", "Summary, customers, countries, products, orders")}</span>
                  </span>
                </button>
              </div>
            )}
          </Popover>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <DateRangePicker
              label={t("Dönem", "Period")}
              value={period}
              custom={{ start: customStart, end: customEnd }}
              options={periodOptions}
              onChange={(id, r) => {
                setPeriod(id);
                if (id === CUSTOM && r) {
                  setCustomStart(r.start);
                  setCustomEnd(r.end);
                }
              }}
              className="col-span-2 w-full sm:w-auto"
            />
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={`${select} min-w-0`}>
              <option value="">{t("Tüm ülkeler", "All countries")}</option>
              {(report?.available_countries ?? []).map((c) => (
                <option key={c} value={c}>
                  {countryOf(c)}
                </option>
              ))}
            </select>
        </div>
        <div className="-mx-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 px-4 [scrollbar-width:none] dark:border-neutral-800 sm:mx-0 sm:px-0">
          {(
            [
              ["overview", t("Genel bakış", "Overview")],
              ["products", t("Ürün kârlılığı", "Product profitability")],
              ["orders", t("Sipariş maliyetleri", "Order costs")],
              ["invoices", t("Kargo faturaları", "Shipping invoices")],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === v ? "border-[#D97757] text-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
            >
              {l}
            </button>
          ))}
        </div>
        </div>

        {user && !displayReport && !error && (
          <PageSpinner />
        )}

        {displayReport && k && pk && (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {tab === "overview" && (
              <div className="space-y-5">
                <section className={card}>
                  <div className="mb-3 flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800">
                    {(
                      [
                        ["customers", t("En çok alışveriş yapan müşteriler", "Top customers")],
                        ["best", t("En çok kazandıran siparişler", "Most profitable orders")],
                        ["worst", t("Zarar / düşük kârlı siparişler", "Loss-making / low-profit orders")],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setTopTab(v)}
                        className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${topTab === v ? "border-[#D97757] text-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {(topTab === "best" || topTab === "worst") && shopId !== undefined && (
                    <>
                      <TopOrders
                        rows={topTab === "best" ? displayReport.top_orders : displayReport.worst_orders}
                        shopId={shopId}
                        money2={money2}
                        countryName={countryOf}
                        emptyText={t("Bu dönemde maliyeti girilmiş sipariş yok.", "No orders with costs entered in this period.")}
                      />
                      <p className="mt-2 text-[11px] text-neutral-400">
                        {t(
                          "Sipariş kârı: satış − iade − Etsy ücreti − maliyet (reklam/abonelik gibi ortak giderler hariç).",
                          "Order profit: sales − refunds − Etsy fees − cost (shared costs like ads and subscriptions excluded).",
                        )}
                        {topTab === "worst" && t(" Zarar edenler en üstte.", " Loss-making orders first.")}
                        {displayReport.orders_no_cost > 0 &&
                          t(
                            ` Maliyeti girilmemiş ${displayReport.orders_no_cost} sipariş, kârı gerçeği yansıtmadığı için listeye dahil değil.`,
                            ` ${displayReport.orders_no_cost} orders without costs are left out because their profit would be misleading.`,
                          )}
                      </p>
                    </>
                  )}
                  {topTab === "customers" && (displayReport.customers.length === 0 ? (
                    <p className="text-sm text-neutral-400">{tNow("Bu dönemde sipariş yok.", "No orders in this period.")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800">
                            <th className="py-2 pr-3 font-medium">#</th>
                            <th className="py-2 pr-3 font-medium">{t("Müşteri", "Customer")}</th>
                            <th className="py-2 pr-3 font-medium">{t("Ülke", "Country")}</th>
                            <th className="py-2 pr-3 text-right font-medium">{t("Sipariş", "Orders")}</th>
                            <th className="py-2 pr-3 text-right font-medium">{t("Toplam", "Total")}</th>
                            <th className="py-2 text-right font-medium">{t("Son sipariş", "Last order")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayReport.customers.slice(0, 10).map((c, i) => (
                            <tr key={`${c.name}-${i}`} className="border-b border-neutral-50 last:border-0 dark:border-neutral-800/60">
                              <td className="py-2 pr-3 text-neutral-400">{i + 1}</td>
                              <td className="py-2 pr-3 font-medium">{c.name}</td>
                              <td className="py-2 pr-3 text-neutral-500">{c.country ? countryOf(c.country) : "—"}</td>
                              <td className="py-2 pr-3 text-right">{c.orders}</td>
                              <td className="py-2 pr-3 text-right font-medium">{money2.format(c.sales)}</td>
                              <td className="py-2 text-right text-neutral-500">{c.last}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </section>

                {displayReport.overhead_excluded && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    {t(
                      "Ülke filtresi açık: Etsy Ads, listeleme ve abonelik giderleri ülkeye atanamadığı için bu görünümde hesaba katılmadı. Net kâr ve marj bu yüzden gerçekte olduğundan yüksek görünür.",
                      "Country filter is on: Etsy Ads, listing and subscription costs cannot be assigned to a country, so they are left out here. Net profit and margin therefore look higher than they really are.",
                    )}
                  </p>
                )}
                <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <Kpi label={t("Satış (vergi hariç)", "Sales (excl. tax)")} value={fmt(k.sales)} sub={<Delta label={cmpLabel} cur={k.sales} prev={pk.sales} />} extra={t(`${k.orders} sipariş`, `${k.orders} orders`)} />
                  <Kpi
                    label={t("Etsy ücretleri", "Etsy fees")}
                    value={fmt(k.fees + k.overhead)}
                    sub={<Delta label={cmpLabel} cur={k.fees + k.overhead} prev={pk.fees + pk.overhead} invert />}
                    extra={`${t("Sipariş", "Orders")} ${fmt(k.fees)} · ${t("Reklam/diğer", "Ads/other")} ${fmt(k.overhead)}`}
                  />
                  <Kpi
                    label={t("Ürün + kargo maliyeti", "Product + shipping cost")}
                    value={fmt(k.cogs)}
                    sub={k.cogs === 0 ? <span className="text-xs text-amber-600">{t("Maliyet girilmemiş", "No costs entered")}</span> : <Delta label={cmpLabel} cur={k.cogs} prev={pk.cogs} invert />}
                    extra={t("Ürün kârlılığı sekmesinden girilir", "Entered on the Product profitability tab")}
                  />
                  <Kpi label={t("Net kâr", "Net profit")} value={fmt(k.profit)} sub={<Delta label={cmpLabel} cur={k.profit} prev={pk.profit} />} highlight />
                  <Kpi label={t("Kâr marjı", "Profit margin")} value={`%${k.margin.toFixed(1)}`} sub={<span className="text-xs text-neutral-400">{cmpLabel}: %{pk.margin.toFixed(1)}</span>} />
                  <Kpi label={t("İadeler", "Refunds")} value={fmt(k.refunds)} sub={<Delta label={cmpLabel} cur={k.refunds} prev={pk.refunds} invert />} />
                </section>

                <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Metric label={t("Satılan ürün adedi", "Units sold")} value={k.units.toLocaleString(locale)} sub={<Delta label={cmpLabel} cur={k.units} prev={pk.units} />} />
                  <Metric label={t("Ortalama sipariş değeri", "Average order value")} value={money2.format(k.aov)} sub={<Delta label={cmpLabel} cur={k.aov} prev={pk.aov} />} />
                  <Metric
                    label={t("Etsy'ye giden pay", "Share paid to Etsy")}
                    value={`%${k.etsy_share.toFixed(1)}`}
                    hint={t("Sipariş ücretleri + reklam + yenileme, satışa oranı", "Order fees + ads + renewals, as a share of sales")}
                    sub={<span className="text-xs text-neutral-400">{cmpLabel}: %{pk.etsy_share.toFixed(1)}</span>}
                  />
                  <Metric
                    label={t("Reklam harcaması", "Ad spend")}
                    value={fmt(k.ads)}
                    hint={t("Etsy Ads + Offsite Ads; satışa oranı", "Etsy Ads + Offsite Ads; as a share of sales")}
                    sub={<span className="text-xs text-neutral-400">
                        {t(`satışın %${k.ads_pct.toFixed(1)}'i`, `${k.ads_pct.toFixed(1)}% of sales`)} · {cmpLabel}: %{pk.ads_pct.toFixed(1)}
                      </span>}
                  />
                  <Metric
                    label={t("İade + iptal oranı", "Refund + cancellation rate")}
                    value={`%${k.problem_pct.toFixed(1)}`}
                    hint={t(`${k.canceled} iptal, ${k.refunded_orders} iadeli sipariş / ${k.all_orders} sipariş`, `${k.canceled} canceled, ${k.refunded_orders} refunded / ${k.all_orders} orders`)}
                    sub={<span className="text-xs text-neutral-400">{cmpLabel}: %{pk.problem_pct.toFixed(1)}</span>}
                  />
                </section>

                <section className={card}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("Aylık satış karşılaştırması", "Monthly sales comparison")}</h2>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                      {t("Yıllar", "Years")}
                      {[0, 1, 2].map((slot) => {
                        const value = chartSel[slot] || (slot === 0 ? String(baseYear) : slot === 1 ? String(baseYear - 1) : "none");
                        return (
                          <select
                            key={slot}
                            value={value}
                            onChange={(e) => setChartSel((prev) => prev.map((v, i) => (i === slot ? e.target.value : v)))}
                            className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                          >
                            {slot > 0 && <option value="none">{t("— yok —", "— none —")}</option>}
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
                    data={displayReport.series
                      .filter((sp) => sp.month.slice(0, 4) === String(baseYear)) // bu grafik "bu yılın ayı vs geçen yıllar" karşılaştırması;
                      // "Tüm zamanlar"/çok yıllı özel aralıkta series birden fazla yılın aylarını içerebilir, aynı ay adı (Oca, Şub…)
                      // birden fazla kez gelip React key çakışmasına yol açardı.
                      .map((sp) => ({
                      label: monthLabel(sp.month).slice(0, 3),
                      values: chartSorted.map((y) =>
                        y === baseYear ? sp.sales : baseYear - y === displayReport.offsets[0] ? sp.prev_sales : (sp.cmp.find((c) => c.offset === baseYear - y)?.sales ?? 0),
                      ),
                    }))}
                    series={compareSeries}
                    fmt={fmt}
                  />
                </section>

                <section className={card}>
                  <h2 className={h2}>{t("Satış nereye gidiyor?", "Where do sales go?")}</h2>
                  <StackedBars
                    data={displayReport.series.map((s) => ({ label: monthLabel(s.month), parts: [s.profit, s.cogs, s.fees, s.overhead] }))}
                    legend={[
                      { name: t("Net kâr", "Net profit"), color: "#10b981" },
                      { name: t("Ürün + kargo", "Product + shipping"), color: "#6366f1" },
                      { name: t("Sipariş ücretleri", "Order fees"), color: "#D97757" },
                      { name: t("Reklam / diğer", "Ads / other"), color: "#f59e0b" },
                    ]}
                    fmt={fmt}
                  />
                  <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                    {[...Object.entries(k.fee_types), ...Object.entries(k.overhead_types)].map(([n, v]) => (
                      <div key={n} className="flex justify-between border-b border-neutral-100 py-1 dark:border-neutral-800">
                        <span className="text-neutral-600 dark:text-neutral-300">{n}</span>
                        <span className="font-medium">{money2.format(v)}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={card}>
                  <h2 className={h2}>{t("Hangi ülkeye satış yapıldı?", "Sales by country")}</h2>
                  <CountryBars rows={displayReport.countries} fmt={fmt} cur={String(baseYear)} prev={cmpLabel} />
                </section>
              </div>
            )}

            {tab === "products" && shopId !== undefined && (
              <ProductCosts
                products={displayReport.products}
                shopId={shopId}
                money2={money2}
                onSaved={scheduleRefresh}
                onSortChange={setProdSort}
                fixedCost={displayReport.settings.order_fixed_cost}
                currency={cur}
              />
            )}
            {tab === "orders" && shopId !== undefined && (
              <OrderCosts shopId={shopId} range={range} money2={money2} onSaved={scheduleRefresh} onQuery={setOrderQ} />
            )}
            {tab === "invoices" && shopId !== undefined && (
              <ShippingInvoices shopId={shopId} products={displayReport.products} money2={money2} onSaved={scheduleRefresh} />
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
  if (rows.length === 0) return <p className="text-sm text-neutral-400">{tNow("Bu dönemde sipariş yok.", "No orders in this period.")}</p>;
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-xs text-neutral-600 dark:text-neutral-300">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#D97757]" />
          {cur}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-neutral-300" />
          {prev}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.iso} className="grid grid-cols-[7rem_1fr_9rem] items-center gap-3 text-sm">
          <span className="truncate font-medium">{r.iso === "??" ? tNow("Bilinmiyor", "Unknown") : countryOf(r.iso)}</span>
          <div className="space-y-1">
            <div className="h-2.5 rounded bg-[#D97757]" style={{ width: `${(r.sales / max) * 100}%` }} />
            <div className="h-2.5 rounded bg-neutral-300 dark:bg-neutral-600" style={{ width: `${(r.prev_sales / max) * 100}%` }} />
          </div>
          <span className="text-right text-xs text-neutral-500">
            <b className="text-neutral-900 dark:text-neutral-100">{fmt(r.sales)}</b> · {r.orders} {tNow("sip.", "orders")}
            <br />
            {prev}: {fmt(r.prev_sales)}
          </span>
        </div>
      ))}
    </div>
  );
}

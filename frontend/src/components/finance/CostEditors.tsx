"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/listing-editor/Modal";
import { api, FinOrderCost, FinOrdersPage, FinProduct, FinVariant } from "@/lib/api";
import OrderCostBreakdown from "./OrderCostBreakdown";
import OrderDetailModal from "./OrderDetailModal";
import ProductThumb from "./ProductThumb";
import FulfillmentTimes from "@/components/orders/FulfillmentTimes";
import { tNow as t } from "@/lib/i18n";
import { useCached } from "@/lib/pageCache";
import { BlockSpinner } from "@/components/ui/Spinner";
import EtsyLink from "@/components/ui/EtsyLink";

const card = "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
const inputBase = "w-20 rounded border px-2 py-1 text-right text-sm focus:border-[#D97757] focus:outline-none";
const inputCls = `${inputBase} border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900`;
const filledCls = `${inputBase} border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40`;

const num = (v: string) => Number(v.replace(",", ".") || 0);
const initial = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? "" : String(v));

/** "USD" -> "$", "EUR" -> "€"… kod tanınmazsa kodun kendisini döner. */
function currencySymbol(code: string): string {
  try {
    return (0)
      .toLocaleString(t("tr-TR", "en-US"), { style: "currency", currency: code, minimumFractionDigits: 0, maximumFractionDigits: 0 })
      .replace(/[\d\s]/g, "");
  } catch {
    return code;
  }
}

/** Maliyet/kargo/fiyat% kutularının kenarında birim simgesi gösterir (para birimi solda, % sağda) — hangi birimde
 * girildiği belirsiz kalmasın. Üç kutu da aynı genişlikte (`inputBase`'in w-20'si), satırdaki hizalama bozulmasın. */
function UnitInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  symbol,
  side = "prefix",
  className,
  placeholder = "0",
  adornment,
}: {
  /** Kutunun içinde, sağ köşede duran küçük öğe (ör. fatura ikonu) — hücre genişliğini değiştirmez. */
  adornment?: React.ReactNode;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  symbol: string;
  side?: "prefix" | "suffix";
  className: string;
}) {
  return (
    <span className="relative inline-block">
      <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[11px] text-neutral-400 ${side === "prefix" ? "left-1.5" : "right-1.5"}`}>{symbol}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        inputMode="decimal"
        placeholder={placeholder}
        className={`${className} ${side === "prefix" ? "pl-4" : "pr-4"} ${adornment ? "pr-6" : ""}`}
      />
      {adornment && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{adornment}</span>}
    </span>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/422|validation|less than or equal|greater than/i.test(m)) return t("Geçersiz değer", "Invalid value");
  return t("Kaydedilemedi", "Could not save");
}

/** Kaydı arka planda yapar; kutular hiç kilitlenmez, Tab ile bir sonrakine geçilebilir. */
function useAutoSave(save: () => Promise<unknown>, onSaved: () => void) {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = () => {
    setState("saving");
    save()
      .then(() => {
        setState("saved");
        onSaved();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 1500);
      })
      .catch((e) => {
        setMessage(errorText(e));
        setState("error");
      });
  };
  return [state, run, message] as const;
}

function StateMark({ state, message, filled }: { state: SaveState; message?: string; filled?: boolean }) {
  if (state === "saving") return <span className="whitespace-nowrap text-[11px] text-neutral-400">{t("Kaydediliyor…", "Saving…")}</span>;
  if (state === "saved") return <span className="whitespace-nowrap text-[11px] font-medium text-emerald-600">✓ {t("Kaydedildi", "Saved")}</span>;
  if (state === "error") return <span className="whitespace-nowrap text-[11px] font-medium text-red-600">{message || t("Kaydedilemedi", "Could not save")}</span>;
  if (filled) return <span className="whitespace-nowrap text-[11px] text-emerald-700/70 dark:text-emerald-400/70">{t("Kayıtlı", "Saved")}</span>;
  return <span className="text-[11px] text-neutral-300 dark:text-neutral-700">—</span>;
}

/** Kargo faturası özeti: kutunun yanında küçük bir ikon; ayrıntı fare üzerine gelince görünür. Faturasız adet varsa ikon sarı. */
/** Turuncu, yuvarlak içinde "i". `filled`: dikkat gerektiren durum (ör. faturasız adet var) için dolu, aksi halde çerçeveli. */
export function InfoDot({ filled = false }: { filled?: boolean }) {
  return (
    <span
      className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold italic leading-none ${
        filled ? "border-[#D97757] bg-[#D97757] text-white" : "border-[#D97757] text-[#D97757]"
      }`}
    >
      i
    </span>
  );
}

type InvoiceOrder = { receipt_id: number; buyer: string; date: string; tracking: string; invoice: number | null };

function InvoiceInfo({ invoice, manual, orders }: { invoice: { amount: number; count: number; units: number }; manual: boolean; orders: InvoiceOrder[] }) {
  const missing = invoice.units - invoice.count;
  const [open, setOpen] = useState(false);
  const withInv = orders.filter((o) => o.invoice !== null);
  const without = orders.filter((o) => o.invoice === null);
  const row = "flex items-center justify-between gap-3 border-b border-neutral-100 py-1.5 text-sm last:border-0 dark:border-neutral-800";
  return (
    <span className="group relative block leading-none">
      <button type="button" onClick={() => setOpen(true)} className="cursor-pointer" aria-label={t("Kargo faturası detayı", "Shipping invoice details")}>
        <InfoDot filled={missing > 0} />
      </button>
      {open &&
        createPortal(
        <Modal title={t(`Kargo faturaları · ${withInv.length}/${orders.length} sipariş faturalı`, `Shipping invoices · ${withInv.length}/${orders.length} orders invoiced`)} widthClass="max-w-lg" onClose={() => setOpen(false)} z={120}>
          <div className="text-left" onClick={(e) => e.stopPropagation()}>
            {without.length > 0 && (
              <>
                <p className="mb-1 text-xs font-semibold text-amber-600 dark:text-amber-400">{t(`Faturasız (${without.length}) — kargosu şu an 0 görünüyor`, `No invoice (${without.length}) — shipping shows as 0 for now`)}</p>
                <div className="mb-4">
                  {without.map((o) => (
                    <div key={o.receipt_id} className={row}>
                      <span>
                        {o.buyer || "—"} <span className="text-xs text-neutral-400">· {o.date}</span>
                      </span>
                      <span className="text-xs text-neutral-500">{o.tracking || t("takip no yok", "no tracking no.")}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p className="mb-1 text-xs font-semibold text-sky-700 dark:text-sky-400">{t("Faturalı", "Invoiced")} ({withInv.length})</p>
            <div>
              {withInv.map((o) => (
                <div key={o.receipt_id} className={row}>
                  <span>
                    {o.buyer || "—"} <span className="text-xs text-neutral-400">· {o.date}</span>
                  </span>
                  <span className="text-xs text-neutral-500">
                    {o.tracking || "—"} · <b className="text-neutral-800 dark:text-neutral-100">{(o.invoice ?? 0).toFixed(2)}</b>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-neutral-400">{t('Eksik faturaları "Kargo faturaları" sekmesinden yükleyin; takip no ile otomatik eşleşir.', 'Upload missing invoices on the "Shipping invoices" tab; they match automatically by tracking number.')}</p>
          </div>
        </Modal>,
        document.body
      )}
      <span className="pointer-events-none absolute right-full top-1/2 z-30 mr-1 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1.5 text-left text-[11px] leading-snug text-white shadow-lg group-hover:block dark:bg-neutral-700">
        <span className="block">
          {t(`${invoice.count} siparişte fatura:`, `Invoices on ${invoice.count} orders:`)} <b>{invoice.amount.toFixed(2)}</b>
        </span>
        <span className="block text-neutral-300">{manual
            ? t("Faturalı siparişlerde fatura, faturasızlarda elle girilen değer kullanılır", "Invoiced orders use the invoice; others use the value you entered")
            : t("Faturalı siparişlerde fatura tutarı kullanılıyor", "Invoiced orders use the invoice amount")}</span>
        {missing > 0 && <span className="block text-amber-300">{t(`${missing} adet faturasız`, `${missing} units without invoice`)}</span>}
      </span>
    </span>
  );
}

function CostInputs({
  init,
  onSave,
  onSaved,
  noShip,
  currency,
  weightKg,
  invoice,
  orders,
}: {
  /** Fatura ikonuna tıklanınca gösterilen sipariş listesi (faturalı/faturasız). */
  orders?: InvoiceOrder[];
  init: { unit: number | null; ship: number | null; pct: number | null };
  onSave: (unit: number, ship: number, pct: number) => Promise<unknown>;
  onSaved: () => void;
  noShip?: boolean;
  currency: string;
  /** Yüklenen faturalardan ortalama ağırlık; yalnızca bilgi. */
  weightKg?: number | null;
  /** Seçili dönemde bu seçeneğe yüklenen kargo faturaları: toplam tutar, faturalı sipariş sayısı, toplam adet. */
  invoice?: { amount: number; count: number; units: number };
}) {
  const symbol = currencySymbol(currency);
  const [unit, setUnit] = useState(initial(init.unit));
  const [ship, setShip] = useState(initial(init.ship));
  const [pct, setPct] = useState(initial(init.pct));
  const last = useRef(`${unit}|${ship}|${pct}`);
  const filled = unit !== "" || ship !== "" || pct !== "";
  const [state, run, message] = useAutoSave(() => onSave(num(unit), num(ship), num(pct)), onSaved);
  const commit = () => {
    const now = `${unit}|${ship}|${pct}`;
    if (now === last.current) return;
    if ([unit, ship, pct].some((v) => Number.isNaN(num(v)))) return;
    last.current = now;
    run();
  };
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };
  return (
    <>
      <td className="py-2 pr-2 text-right">
        <UnitInput value={unit} onChange={setUnit} onBlur={commit} onKeyDown={keys} symbol={symbol} className={unit !== "" ? filledCls : inputCls} />
      </td>
      <td className="py-2 pr-2 text-right">
        {noShip ? (
          <span className="text-xs text-neutral-400" title={t("Dijital ürün: kargo maliyeti yok", "Digital item: no shipping cost")}>
            {t("dijital", "digital")}
          </span>
        ) : (
          <UnitInput
            value={ship}
            onChange={setShip}
            onBlur={commit}
            onKeyDown={keys}
            symbol={symbol}
            placeholder={invoice && invoice.count > 0 ? (invoice.amount / invoice.count).toFixed(2) : "0"}
            adornment={invoice && invoice.count > 0 ? <InvoiceInfo invoice={invoice} manual={ship !== "" && Number(ship) > 0} orders={orders ?? []} /> : undefined}
            className={`${ship !== "" ? filledCls : inputCls} ${invoice && invoice.count > 0 && ship === "" ? "placeholder:font-medium placeholder:text-sky-600 dark:placeholder:text-sky-400" : ""}`}
          />
        )}
      </td>
      <td className="py-2 pr-2 text-right">
        <UnitInput value={pct} onChange={setPct} onBlur={commit} onKeyDown={keys} symbol="%" side="suffix" className={pct !== "" ? filledCls : inputCls} />
      </td>
      <td className="py-2 pr-2 text-right text-xs text-neutral-500">{weightKg ? weightKg : "—"}</td>
      <td className="w-28 py-2 pr-2">
        <StateMark state={state} message={message} filled={filled} />
      </td>
    </>
  );
}

/** Sipariş başına sabit gider (ambalaj, koli, etiket…): tüm siparişlere (dijital olanlar hariç) uygulanır. */
function FixedCostCard({ shopId, initial, currency, onSaved }: { shopId: number; initial: number; currency: string; onSaved: () => void }) {
  const [val, setVal] = useState(initial ? String(initial) : "");
  const last = useRef(val);
  const [state, run, message] = useAutoSave(() => api.finance.setOrderFixedCost(shopId, num(val)), onSaved);
  const commit = () => {
    if (val === last.current || Number.isNaN(num(val))) return;
    last.current = val;
    run();
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="min-w-[14rem] flex-1">
        <div className="text-sm font-medium">{t("Sipariş başına sabit gider", "Fixed cost per order")}</div>
        <div className="text-xs text-neutral-500">
          {t(
            "Ambalaj, koli, etiket gibi her siparişe giden gider. Ürün maliyetine ayrıca yazmanıza gerek kalmaz. Tümü dijital olan siparişlere uygulanmaz.",
            "A cost that goes into every order, like packaging, boxes and labels. You don't need to add it to product costs. Not applied to all-digital orders.",
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          inputMode="decimal"
          placeholder="0"
          className={val !== "" ? filledCls : inputCls}
        />
        <span className="text-xs text-neutral-500">{currency} / {t("sipariş", "order")}</span>
        <span className="w-28">
          <StateMark state={state} message={message} filled={val !== ""} />
        </span>
      </div>
    </div>
  );
}

export function ProductCosts({
  products,
  shopId,
  money2,
  onSaved,
  onSortChange,
  fixedCost,
  currency,
}: {
  products: FinProduct[];
  shopId: number;
  money2: Intl.NumberFormat;
  onSaved: () => void;
  onSortChange?: (s: string) => void;
  fixedCost: number;
  currency: string;
}) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState<"sales" | "profit" | "margin">("sales");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const needle = search.trim().toLowerCase();
  const sorted = [...products].sort((a, b) => b[sort] - a[sort]).filter((p) => !needle || p.title.toLowerCase().includes(needle) || String(p.listing_id).includes(needle) || (p.buyers ?? []).some((b) => b.toLowerCase().includes(needle)));
  const rows = sorted.slice(0, limit);
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t("Ürün kârlılığı", "Product profitability")}</h2>
        </div>
        <input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(50); }} placeholder={t("Ürün ya da müşteri ara", "Search item or customer")} className="w-48 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
        <select value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); onSortChange?.(e.target.value); }} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          <option value="sales">{t("Satışa göre", "By sales")}</option>
          <option value="profit">{t("Kâra göre", "By profit")}</option>
          <option value="margin">{t("Marja göre", "By margin")}</option>
        </select>
      </div>
      <FixedCostCard shopId={shopId} initial={fixedCost} currency={currency} onSaved={onSaved} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3 font-medium">{t("Ürün", "Item")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("Adet", "Units")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("Satış", "Sales")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("Etsy ücreti", "Etsy fees")}</th>
              <th className="py-2 pr-2 text-right font-medium">{t("Maliyet", "Cost")}</th>
              <th className="py-2 pr-2 text-right font-medium">{t("Kargo", "Shipping")}</th>
              <th className="py-2 pr-2 text-right font-medium">{t("Fiyat %", "Price %")}</th>
              <th className="py-2 pr-2 text-right font-medium">Kg</th>
              <th className="py-2 pr-2 text-left font-medium">{t("Kayıt", "Status")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("Kalan", "Profit")}</th>
              <th className="py-2 text-right font-medium">{t("Marj", "Margin")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, idx) => (
              <Fragment key={p.listing_id}>
                <tr className={`border-b border-neutral-100 dark:border-neutral-800 ${idx % 2 === 0 ? "bg-white dark:bg-neutral-900" : "bg-neutral-100/70 dark:bg-neutral-800/40"}`}>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => toggle(p.listing_id)} className="flex items-center gap-2 text-left">
                      <span className="w-3 text-xs text-neutral-400">{open.has(p.listing_id) ? "▼" : "▶"}</span>
                      <ProductThumb src={p.image} />
                      <span className="max-w-xs">
                        <span className="line-clamp-2 text-[13px]">{p.title || `Listing ${p.listing_id}`}</span>
                        <span className="text-[11px] text-neutral-400">
                          {p.variants.length} {t("seçenek", "variants")}
                          {p.is_digital && <span className="ml-1 rounded bg-sky-100 px-1 text-sky-700 dark:bg-sky-950 dark:text-sky-300">{t("Dijital", "Digital")}</span>}
                          {p.variants.some((v) => v.unit_cost !== null) && (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              {" · "}
                              {t(`${p.variants.filter((v) => v.unit_cost !== null).length} seçenekte maliyet var`, `${p.variants.filter((v) => v.unit_cost !== null).length} variants have costs`)}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    <EtsyLink listingId={p.listing_id} className="ml-5 text-[11px]" />
                  </td>
                  <td className="py-2 pr-3 text-right">{p.units}</td>
                  <td className="py-2 pr-3 text-right">{money2.format(p.sales)}</td>
                  <td className="py-2 pr-3 text-right text-neutral-500">{money2.format(p.fees)}</td>
                  <CostInputs
                    init={{ unit: p.unit_cost, ship: p.shipping_cost, pct: p.cost_pct }}
                    onSave={(u, s, c) => api.finance.setCost(shopId, p.listing_id, u, s, c)}
                    onSaved={onSaved}
                    noShip={p.is_digital}
                    currency={currency}
                  />
                  <td className={`py-2 pr-3 text-right font-semibold ${p.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{money2.format(p.profit)}</td>
                  <td className="py-2 text-right text-neutral-500">%{p.margin.toFixed(0)}</td>
                </tr>
                {open.has(p.listing_id) &&
                  p.variants.map((v) => <VariantRow key={v.key} v={v} listingId={p.listing_id} shopId={shopId} money2={money2} onSaved={onSaved} currency={currency} />)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > rows.length && (
        <div className="mt-3 text-center">
          <button type="button" onClick={() => setLimit((l) => l + 50)} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
            {t(`Daha fazla göster (${sorted.length - rows.length} ürün daha)`, `Show more (${sorted.length - rows.length} more items)`)}
          </button>
        </div>
      )}
      {sorted.length === 0 && <p className="py-4 text-sm text-neutral-400">{t("Ürün bulunamadı.", "No items found.")}</p>}
    </section>
  );
}

function VariantRow({ v, listingId, shopId, money2, onSaved, currency }: { v: FinVariant; listingId: number; shopId: number; money2: Intl.NumberFormat; onSaved: () => void; currency: string }) {
  const profit = (v.sales ?? 0) - (v.fees ?? 0) - (v.refunds ?? 0) - (v.cogs ?? 0);
  const valid = Number.isFinite(profit);
  const margin = valid && v.sales > 0 ? (profit / v.sales) * 100 : 0;
  return (
    <tr className="border-b border-sky-100 bg-sky-50/70 text-[13px] dark:border-sky-950 dark:bg-sky-950/20">
      <td className="py-1.5 pl-14 pr-3 text-neutral-600 dark:text-neutral-300">
        {v.key || t("Seçeneksiz", "No variation")}
      </td>
      <td className="py-1.5 pr-3 text-right">{v.units}</td>
      <td className="py-1.5 pr-3 text-right">{money2.format(v.sales)}</td>
      <td className="py-1.5 pr-3 text-right text-neutral-500">{money2.format(v.fees)}</td>
      <CostInputs
        init={{ unit: v.unit_cost, ship: v.shipping_cost, pct: v.cost_pct }}
        onSave={(u, s, c) => api.finance.setVariantCost(shopId, listingId, v.key, u, s, c)}
        onSaved={onSaved}
        noShip={v.is_digital}
        currency={currency}
        weightKg={v.weight_kg}
        invoice={{ amount: v.invoice_amount, count: v.invoice_count, units: v.units }}
        orders={v.orders}
      />
      <td className={`py-1.5 pr-3 text-right font-semibold ${!valid ? "text-neutral-400" : profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{valid ? money2.format(profit) : "—"}</td>
      <td className="py-1.5 text-right text-neutral-500">{valid ? `%${margin.toFixed(0)}` : "—"}</td>
    </tr>
  );
}

/** Sipariş bazlı maliyet: dolu kutu, otomatik hesabın yerine geçer; boşaltınca otomatik hesaba döner. */
export function OrderCosts({
  shopId,
  range,
  money2,
  onSaved,
  onQuery,
}: {
  shopId: number;
  range: { start: string; end: string };
  money2: Intl.NumberFormat;
  onSaved: () => void;
  onQuery?: (q: string) => void;
}) {
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useCached<FinOrdersPage>(`fin-orders:${shopId}:${range.start}:${range.end}:${q}:${page}`, { keepPrevious: true });
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [breakdownId, setBreakdownId] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput);
      setPage(0);
      onQuery?.(qInput);
    }, 350);
    return () => clearTimeout(timer);
  }, [qInput, onQuery]);

  useEffect(() => {
    let cancelled = false;
    api.finance
      .orders(shopId, range.start, range.end, q, page)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, range.start, range.end, q, page, setData]);

  const pages = data ? Math.max(1, Math.ceil(data.total / 30)) : 1;
  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t("Sipariş maliyetleri", "Order costs")}</h2>
          <p className="max-w-2xl text-xs text-neutral-500">
            {t(
              "Otomatik maliyet, ürün/seçenek maliyetlerinden hesaplanır. Bir siparişin gerçek toplam maliyetini (ürün + kargo) sağdaki kutuya yazarsanız o sipariş için otomatik hesabın yerine geçer; kutuyu boşaltırsanız otomatiğe döner. Kutular yazdıkça kaydolur.",
              "The automatic cost is calculated from item/variant costs. If you enter an order's real total cost (item + shipping) in the box on the right, it replaces the automatic value for that order; clear the box to go back to automatic. Boxes save as you type.",
            )}
          </p>
        </div>
        <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t("Müşteri, ürün veya sipariş no ara", "Search customer, item or order number")} className="w-64 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3 font-medium">{t("Tarih", "Date")}</th>
              <th className="py-2 pr-3 font-medium">{t("Müşteri / ürün", "Customer / item")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("Sipariş tutarı", "Order total")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("Otomatik maliyet", "Automatic cost")}</th>
              <th className="py-2 pr-2 text-right font-medium" title={t("Boşsa otomatik maliyet kullanılır", "If empty, the automatic cost is used")}>
                {t("Gerçek maliyet (isteğe bağlı)", "Real cost (optional)")}
              </th>
              <th className="py-2 pr-3 text-right font-medium" title={t("Kazanç (Etsy ücretleri ve vergi düşülmüş) − iade − maliyet", "Earnings (after Etsy fees and tax) − refunds − cost")}>
                {t("Kâr", "Profit")}
              </th>
              <th className="py-2 pr-2 text-left font-medium">{t("Kayıt", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.orders ?? []).map((o) => (
              <OrderRow key={o.receipt_id} o={o} shopId={shopId} money2={money2} onSaved={onSaved} onOpen={() => setDetailId(o.receipt_id)} onBreakdown={setBreakdownId} currency={data?.currency ?? o.original_currency} />
            ))}
          </tbody>
        </table>
      </div>
      {!data && !error && <BlockSpinner />}
      {data && data.orders.length === 0 && <p className="py-4 text-sm text-neutral-400">{t("Bu dönemde sipariş bulunamadı.", "No orders found in this period.")}</p>}
      {data && pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3 text-sm text-neutral-500">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">
            ‹ {t("Önceki", "Previous")}
          </button>
          <span>
            {page + 1} / {pages} · {data.total} {t("sipariş", "orders")}
          </span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">
            {t("Sonraki", "Next")} ›
          </button>
        </div>
      )}
      {detailId !== null && <OrderDetailModal shopId={shopId} receiptId={detailId} onClose={() => setDetailId(null)} />}
      {breakdownId !== null && <OrderCostBreakdown shopId={shopId} receiptId={breakdownId} money2={money2} onClose={() => setBreakdownId(null)} />}
    </section>
  );
}

/** Siparişin kârı: kazanç (Etsy sonrası) − iade − maliyet. Kutuya yazdıkça anında güncellenir. */
function ProfitCell({ o, val, money2 }: { o: FinOrderCost; val: string; money2: Intl.NumberFormat }) {
  const typed = val.trim() !== "" && !Number.isNaN(num(val));
  const cost = typed ? num(val) : o.auto_defined ? o.auto_cost : null;
  if (cost === null) return <span className="text-xs text-neutral-400">{t("maliyet girilince", "once cost is entered")}</span>;
  const profit = o.earned - o.refunds - cost;
  const margin = o.sales > 0 ? (profit / o.sales) * 100 : 0;
  const cls = profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <div title={o.fees_known ? undefined : t("Etsy ücret kaydı henüz yok; ücretler hesaba katılmadı", "No Etsy fee records yet; fees are not included")}>
      <div className={`font-semibold ${cls}`}>
        {money2.format(profit)} <span className="text-xs font-medium">%{margin.toFixed(0)}</span>
      </div>
      {!o.fees_known && <div className="text-[11px] text-amber-600">{t("ücretler bekleniyor", "fees pending")}</div>}
    </div>
  );
}

function OrderRow({ o, shopId, money2, onSaved, onOpen, onBreakdown, currency }: { o: FinOrderCost; shopId: number; money2: Intl.NumberFormat; onSaved: () => void; onOpen: () => void; onBreakdown: (receiptId: number) => void; currency: string }) {
  const [val, setVal] = useState(o.override === null ? "" : String(o.override));
  const last = useRef(val);
  const [state, run, message] = useAutoSave(() => api.finance.setOrderCost(shopId, o.receipt_id, val === "" ? null : num(val)), onSaved);
  const commit = () => {
    if (val === last.current || Number.isNaN(num(val))) return;
    last.current = val;
    run();
  };
  const undefinedItems = o.items.some((i) => !i.defined);
  return (
    <tr className="border-b border-neutral-100 align-top last:border-0 odd:bg-white even:bg-neutral-100/70 dark:border-neutral-800 dark:odd:bg-neutral-900 dark:even:bg-neutral-800/40">
      <td className="whitespace-nowrap py-2 pr-3 text-neutral-500">{o.date}</td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5 font-medium">
          {o.buyer || "—"}
          <button
            type="button"
            onClick={onOpen}
            title={t("Sipariş detayı ve kazanç", "Order details and earnings")}
            aria-label={t("Sipariş detayı", "Order details")}
            className="rounded p-1 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.5" y2="16.5" />
            </svg>
          </button>
        </div>
        {o.items.map((i, idx) => (
          <div key={idx} className="max-w-md text-xs text-neutral-500">
            {i.quantity}× {i.title.slice(0, 70)}
            {i.variant && <span className="text-neutral-400"> · {i.variant}</span>}
          </div>
        ))}
        <FulfillmentTimes f={o} className="mt-0.5" />
      </td>
      <td className="py-2 pr-3 text-right">
        {money2.format(o.total)}
        {o.original_currency !== currency && (
          <div className="text-[11px] text-neutral-400" title={t("Sipariş bu para biriminde verildi; rapor para birimine çevrildi", "The order was placed in this currency; converted to the report currency")}>
            {o.original_total.toFixed(2)} {o.original_currency}
          </div>
        )}
      </td>
      <td className="py-2 pr-3 text-right">
        {undefinedItems && o.override === null ? (
          <span className="text-xs text-amber-600">{t("maliyet yok", "no cost")}</span>
        ) : (
          <>
            <span className="inline-flex items-center justify-end gap-1.5">
              {money2.format(o.auto_cost)}
              <button type="button" onClick={() => onBreakdown(o.receipt_id)} className="cursor-pointer" aria-label={t("Maliyet dökümü", "Cost breakdown")} title={t("Maliyet dökümü", "Cost breakdown")}>
                <InfoDot filled={o.invoice_ship === null} />
              </button>
            </span>
            {o.fixed_cost > 0 && <div className="text-[11px] text-neutral-400">{t("içinde sabit gider", "incl. fixed cost")} {money2.format(o.fixed_cost)}</div>}
            {o.invoice_ship !== null && <div className="text-[11px] text-sky-600 dark:text-sky-400">{t("kargo faturadan", "shipping from invoice")} {money2.format(o.invoice_ship)}</div>}
          </>
        )}
      </td>
      <td className="py-2 pr-2 text-right">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          inputMode="decimal"
          placeholder={o.auto_cost > 0 ? `${t("otomatik", "auto")} ${o.auto_cost.toFixed(0)}` : t("maliyet gir", "enter cost")}
          title={t("Boş bırakırsanız soldaki otomatik maliyet kullanılır. Bir tutar yazarsanız bu siparişte o tutar geçerli olur.", "Leave empty to use the automatic cost on the left. If you enter an amount, it applies to this order.")}
          className={`${val !== "" ? filledCls : inputCls} w-28`}
        />
      </td>
      <td className="whitespace-nowrap py-2 pr-3 text-right">
        <ProfitCell o={o} val={val} money2={money2} />
      </td>
      <td className="w-28 py-2 pr-2">
        <StateMark state={state} message={message} />
      </td>
    </tr>
  );
}

"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { api, FinOrderCost, FinOrdersPage, FinProduct, FinVariant } from "@/lib/api";
import OrderDetailModal from "./OrderDetailModal";
import ProductThumb from "./ProductThumb";

const card = "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
const inputBase = "w-20 rounded border px-2 py-1 text-right text-sm focus:border-[#F1641E] focus:outline-none";
const inputCls = `${inputBase} border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900`;
const filledCls = `${inputBase} border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40`;

const num = (v: string) => Number(v.replace(",", ".") || 0);
const initial = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? "" : String(v));

type SaveState = "idle" | "saving" | "saved" | "error";

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/422|validation|less than or equal|greater than/i.test(m)) return "Geçersiz değer";
  return "Kaydedilemedi";
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
  if (state === "saving") return <span className="whitespace-nowrap text-[11px] text-neutral-400">Kaydediliyor…</span>;
  if (state === "saved") return <span className="whitespace-nowrap text-[11px] font-medium text-emerald-600">✓ Kaydedildi</span>;
  if (state === "error") return <span className="whitespace-nowrap text-[11px] font-medium text-red-600">{message || "Kaydedilemedi"}</span>;
  return filled ? <span className="whitespace-nowrap text-[11px] text-emerald-700/70 dark:text-emerald-400/70">Kayıtlı</span> : null;
}

function CostInputs({
  init,
  onSave,
  onSaved,
  noShip,
}: {
  init: { unit: number | null; ship: number | null; pct: number | null };
  onSave: (unit: number, ship: number, pct: number) => Promise<unknown>;
  onSaved: () => void;
  noShip?: boolean;
}) {
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
        <input value={unit} onChange={(e) => setUnit(e.target.value)} onBlur={commit} onKeyDown={keys} inputMode="decimal" placeholder="0" className={unit !== "" ? filledCls : inputCls} />
      </td>
      <td className="py-2 pr-2 text-right">
        {noShip ? (
          <span className="text-xs text-neutral-400" title="Dijital ürün: kargo maliyeti yok">
            dijital
          </span>
        ) : (
          <input value={ship} onChange={(e) => setShip(e.target.value)} onBlur={commit} onKeyDown={keys} inputMode="decimal" placeholder="0" className={ship !== "" ? filledCls : inputCls} />
        )}
      </td>
      <td className="py-2 pr-2 text-right">
        <input value={pct} onChange={(e) => setPct(e.target.value)} onBlur={commit} onKeyDown={keys} inputMode="decimal" placeholder="0" className={`${pct !== "" ? filledCls : inputCls} w-16`} />
      </td>
      <td className="w-28 py-2 pr-2">
        <StateMark state={state} message={message} filled={filled} />
      </td>
    </>
  );
}

/** Sipariş başına sabit gider (ambalaj, koli, etiket…): tüm siparişlere (dijital olanlar hariç) uygulanır. */
function FixedCostCard({ shopId, initial, currency, fixPast, onSaved }: { shopId: number; initial: number; currency: string; fixPast: boolean; onSaved: () => void }) {
  const [val, setVal] = useState(initial ? String(initial) : "");
  const last = useRef(val);
  const [state, run, message] = useAutoSave(() => api.finance.setOrderFixedCost(shopId, num(val), fixPast), onSaved);
  const commit = () => {
    if (val === last.current || Number.isNaN(num(val))) return;
    last.current = val;
    run();
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="min-w-[14rem] flex-1">
        <div className="text-sm font-medium">Sipariş başına sabit gider</div>
        <div className="text-xs text-neutral-500">Ambalaj, koli, etiket gibi her siparişe giden gider. Ürün maliyetine ayrıca yazmanıza gerek kalmaz. Tümü dijital olan siparişlere uygulanmaz.</div>
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
        <span className="text-xs text-neutral-500">{currency} / sipariş</span>
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
  const [fixPast, setFixPast] = useState(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState<"sales" | "profit" | "margin">("sales");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const needle = search.trim().toLowerCase();
  const sorted = [...products].sort((a, b) => b[sort] - a[sort]).filter((p) => !needle || p.title.toLowerCase().includes(needle) || String(p.listing_id).includes(needle));
  const rows = sorted.slice(0, limit);
  const missing = products.filter((p) => p.unit_cost === null && p.cost_pct === null && !p.variants.some((v) => v.unit_cost !== null)).length;
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
          <h2 className="text-base font-semibold">Ürün kârlılığı</h2>
          <p className="max-w-2xl text-xs text-neutral-500">
            Kutular yazdıkça kaydolur (Tab ile ilerleyebilirsiniz). Maliyet = sabit tutar + satış fiyatının yüzdesi + kargo. Ürünün satırını açıp her boyut/seçenek için ayrı maliyet girerseniz o seçenek listing
            maliyetinin yerine geçer. Özel siparişler için &quot;Sipariş maliyetleri&quot; sekmesi.
            {missing > 0 && ` ${missing} üründe maliyet girilmemiş.`}
          </p>
          <label className="mt-2 flex max-w-2xl cursor-pointer items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={fixPast} onChange={(e) => setFixPast(e.target.checked)} className="mt-0.5 accent-[#F1641E]" />
            <span>
              <b>Geçmiş siparişleri de güncelle.</b> Kapalıyken (önerilen) daha önce girilmiş bir maliyeti değiştirdiğinizde eski değer geçmiş siparişlerde korunur, yeni değer bugünden itibaren uygulanır. İlk kez girilen maliyet
              her zaman tüm geçmişe uygulanır. Yazım hatasını düzeltiyorsanız bunu açın.
            </span>
          </label>
        </div>
        <input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(50); }} placeholder="Ürün ara" className="w-48 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
        <select value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); onSortChange?.(e.target.value); }} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          <option value="sales">Satışa göre</option>
          <option value="profit">Kâra göre</option>
          <option value="margin">Marja göre</option>
        </select>
      </div>
      <FixedCostCard shopId={shopId} initial={fixedCost} currency={currency} fixPast={fixPast} onSaved={onSaved} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3 font-medium">Ürün</th>
              <th className="py-2 pr-3 text-right font-medium">Adet</th>
              <th className="py-2 pr-3 text-right font-medium">Satış</th>
              <th className="py-2 pr-3 text-right font-medium">Etsy ücreti</th>
              <th className="py-2 pr-2 text-right font-medium">Maliyet</th>
              <th className="py-2 pr-2 text-right font-medium">Kargo</th>
              <th className="py-2 pr-2 text-right font-medium">Fiyat %</th>
              <th className="py-2 pr-2 text-left font-medium">Kayıt</th>
              <th className="py-2 pr-3 text-right font-medium">Kalan</th>
              <th className="py-2 text-right font-medium">Marj</th>
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
                          {p.variants.length} seçenek
                          {p.is_digital && <span className="ml-1 rounded bg-sky-100 px-1 text-sky-700 dark:bg-sky-950 dark:text-sky-300">Dijital</span>}
                          {p.variants.some((v) => v.unit_cost !== null) && (
                            <span className="text-emerald-700 dark:text-emerald-400"> · {p.variants.filter((v) => v.unit_cost !== null).length} seçenekte maliyet var</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-right">{p.units}</td>
                  <td className="py-2 pr-3 text-right">{money2.format(p.sales)}</td>
                  <td className="py-2 pr-3 text-right text-neutral-500">{money2.format(p.fees)}</td>
                  <CostInputs
                    init={{ unit: p.unit_cost, ship: p.shipping_cost, pct: p.cost_pct }}
                    onSave={(u, s, c) => api.finance.setCost(shopId, p.listing_id, u, s, c, fixPast)}
                    onSaved={onSaved}
                    noShip={p.is_digital}
                  />
                  <td className={`py-2 pr-3 text-right font-semibold ${p.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{money2.format(p.profit)}</td>
                  <td className="py-2 text-right text-neutral-500">%{p.margin.toFixed(0)}</td>
                </tr>
                {open.has(p.listing_id) &&
                  p.variants.map((v) => <VariantRow key={v.key} v={v} listingId={p.listing_id} shopId={shopId} money2={money2} onSaved={onSaved} fixPast={fixPast} />)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > rows.length && (
        <div className="mt-3 text-center">
          <button type="button" onClick={() => setLimit((l) => l + 50)} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
            Daha fazla göster ({sorted.length - rows.length} ürün daha)
          </button>
        </div>
      )}
      {sorted.length === 0 && <p className="py-4 text-sm text-neutral-400">Ürün bulunamadı.</p>}
    </section>
  );
}

function VariantRow({ v, listingId, shopId, money2, onSaved, fixPast }: { v: FinVariant; listingId: number; shopId: number; money2: Intl.NumberFormat; onSaved: () => void; fixPast: boolean }) {
  const profit = (v.sales ?? 0) - (v.fees ?? 0) - (v.refunds ?? 0) - (v.cogs ?? 0);
  const valid = Number.isFinite(profit);
  const margin = valid && v.sales > 0 ? (profit / v.sales) * 100 : 0;
  return (
    <tr className="border-b border-sky-100 bg-sky-50/70 text-[13px] dark:border-sky-950 dark:bg-sky-950/20">
      <td className="py-1.5 pl-14 pr-3 text-neutral-600 dark:text-neutral-300">{v.key || "Seçeneksiz"}</td>
      <td className="py-1.5 pr-3 text-right">{v.units}</td>
      <td className="py-1.5 pr-3 text-right">{money2.format(v.sales)}</td>
      <td className="py-1.5 pr-3 text-right text-neutral-500">{money2.format(v.fees)}</td>
      <CostInputs
        init={{ unit: v.unit_cost, ship: v.shipping_cost, pct: v.cost_pct }}
        onSave={(u, s, c) => api.finance.setVariantCost(shopId, listingId, v.key, u, s, c, fixPast)}
        onSaved={onSaved}
        noShip={v.is_digital}
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
  const [data, setData] = useState<FinOrdersPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput);
      setPage(0);
      onQuery?.(qInput);
    }, 350);
    return () => clearTimeout(t);
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
  }, [shopId, range.start, range.end, q, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / 30)) : 1;
  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Sipariş maliyetleri</h2>
          <p className="max-w-2xl text-xs text-neutral-500">
            Otomatik maliyet, ürün/seçenek maliyetlerinden hesaplanır. Bir siparişin gerçek toplam maliyetini (ürün + kargo) sağdaki kutuya yazarsanız o sipariş için otomatik hesabın yerine geçer; kutuyu boşaltırsanız
            otomatiğe döner. Kutular yazdıkça kaydolur.
          </p>
        </div>
        <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Müşteri, ürün veya sipariş no ara" className="w-64 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3 font-medium">Tarih</th>
              <th className="py-2 pr-3 font-medium">Müşteri / ürün</th>
              <th className="py-2 pr-3 text-right font-medium">Sipariş tutarı</th>
              <th className="py-2 pr-3 text-right font-medium">Otomatik maliyet</th>
              <th className="py-2 pr-2 text-right font-medium" title="Boşsa otomatik maliyet kullanılır">Gerçek maliyet (isteğe bağlı)</th>
              <th className="py-2 pr-3 text-right font-medium" title="Kazanç (Etsy ücretleri ve vergi düşülmüş) − iade − maliyet">Kâr</th>
              <th className="py-2 pr-2 text-left font-medium">Kayıt</th>
            </tr>
          </thead>
          <tbody>
            {(data?.orders ?? []).map((o) => (
              <OrderRow key={o.receipt_id} o={o} shopId={shopId} money2={money2} onSaved={onSaved} onOpen={() => setDetailId(o.receipt_id)} currency={data?.currency ?? o.original_currency} />
            ))}
          </tbody>
        </table>
      </div>
      {data && data.orders.length === 0 && <p className="py-4 text-sm text-neutral-400">Bu dönemde sipariş bulunamadı.</p>}
      {data && pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3 text-sm text-neutral-500">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">
            ‹ Önceki
          </button>
          <span>
            {page + 1} / {pages} · {data.total} sipariş
          </span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">
            Sonraki ›
          </button>
        </div>
      )}
      {detailId !== null && <OrderDetailModal shopId={shopId} receiptId={detailId} onClose={() => setDetailId(null)} />}
    </section>
  );
}

/** Siparişin kârı: kazanç (Etsy sonrası) − iade − maliyet. Kutuya yazdıkça anında güncellenir. */
function ProfitCell({ o, val, money2 }: { o: FinOrderCost; val: string; money2: Intl.NumberFormat }) {
  const typed = val.trim() !== "" && !Number.isNaN(num(val));
  const cost = typed ? num(val) : o.auto_defined ? o.auto_cost : null;
  if (cost === null) return <span className="text-xs text-neutral-400">maliyet girilince</span>;
  const profit = o.earned - o.refunds - cost;
  const margin = o.sales > 0 ? (profit / o.sales) * 100 : 0;
  const cls = profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <div title={o.fees_known ? undefined : "Etsy ücret kaydı henüz yok; ücretler hesaba katılmadı"}>
      <div className={`font-semibold ${cls}`}>
        {money2.format(profit)} <span className="text-xs font-medium">%{margin.toFixed(0)}</span>
      </div>
      {!o.fees_known && <div className="text-[11px] text-amber-600">ücretler bekleniyor</div>}
    </div>
  );
}

function OrderRow({ o, shopId, money2, onSaved, onOpen, currency }: { o: FinOrderCost; shopId: number; money2: Intl.NumberFormat; onSaved: () => void; onOpen: () => void; currency: string }) {
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
            title="Sipariş detayı ve kazanç"
            aria-label="Sipariş detayı"
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
      </td>
      <td className="py-2 pr-3 text-right">
        {money2.format(o.total)}
        {o.original_currency !== currency && (
          <div className="text-[11px] text-neutral-400" title="Sipariş bu para biriminde verildi; rapor para birimine çevrildi">
            {o.original_total.toFixed(2)} {o.original_currency}
          </div>
        )}
      </td>
      <td className="py-2 pr-3 text-right">
        {undefinedItems && o.override === null ? (
          <span className="text-xs text-amber-600">maliyet yok</span>
        ) : (
          <>
            {money2.format(o.auto_cost)}
            {o.fixed_cost > 0 && <div className="text-[11px] text-neutral-400">içinde sabit gider {money2.format(o.fixed_cost)}</div>}
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
          placeholder={o.auto_cost > 0 ? `otomatik ${o.auto_cost.toFixed(0)}` : "maliyet gir"}
          title="Boş bırakırsanız soldaki otomatik maliyet kullanılır. Bir tutar yazarsanız bu siparişte o tutar geçerli olur."
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

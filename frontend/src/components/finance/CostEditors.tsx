"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { api, FinOrderCost, FinProduct, FinVariant } from "@/lib/api";
import OrderDetailModal from "./OrderDetailModal";

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
}: {
  init: { unit: number | null; ship: number | null; pct: number | null };
  onSave: (unit: number, ship: number, pct: number) => Promise<unknown>;
  onSaved: () => void;
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
        <input value={ship} onChange={(e) => setShip(e.target.value)} onBlur={commit} onKeyDown={keys} inputMode="decimal" placeholder="0" className={ship !== "" ? filledCls : inputCls} />
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

export function ProductCosts({
  products,
  shopId,
  money2,
  onSaved,
  onSortChange,
}: {
  products: FinProduct[];
  shopId: number;
  money2: Intl.NumberFormat;
  onSaved: () => void;
  onSortChange?: (s: string) => void;
}) {
  const [fixPast, setFixPast] = useState(false);
  const [sort, setSort] = useState<"sales" | "profit" | "margin">("sales");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const rows = [...products].sort((a, b) => b[sort] - a[sort]);
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
        <select value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); onSortChange?.(e.target.value); }} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          <option value="sales">Satışa göre</option>
          <option value="profit">Kâra göre</option>
          <option value="margin">Marja göre</option>
        </select>
      </div>
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
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt="" className="h-9 w-9 flex-shrink-0 rounded object-cover" />
                      ) : (
                        <div className="h-9 w-9 flex-shrink-0 rounded bg-neutral-100 dark:bg-neutral-800" />
                      )}
                      <span className="max-w-xs">
                        <span className="line-clamp-2 text-[13px]">{p.title || `Listing ${p.listing_id}`}</span>
                        <span className="text-[11px] text-neutral-400">
                          {p.variants.length} seçenek
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
    </section>
  );
}

function VariantRow({ v, listingId, shopId, money2, onSaved, fixPast }: { v: FinVariant; listingId: number; shopId: number; money2: Intl.NumberFormat; onSaved: () => void; fixPast: boolean }) {
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
      />
      <td className="py-1.5 pr-3 text-right text-neutral-500">{money2.format(v.sales - v.fees - v.cogs)}</td>
      <td className="py-1.5" />
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
  const [data, setData] = useState<{ total: number; orders: FinOrderCost[] } | null>(null);
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
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3 font-medium">Tarih</th>
              <th className="py-2 pr-3 font-medium">Müşteri / ürün</th>
              <th className="py-2 pr-3 text-right font-medium">Sipariş tutarı</th>
              <th className="py-2 pr-3 text-right font-medium">Otomatik maliyet</th>
              <th className="py-2 pr-2 text-right font-medium" title="Boşsa otomatik maliyet kullanılır">Gerçek maliyet (isteğe bağlı)</th>
              <th className="py-2 pr-2 text-left font-medium">Kayıt</th>
            </tr>
          </thead>
          <tbody>
            {(data?.orders ?? []).map((o) => (
              <OrderRow key={o.receipt_id} o={o} shopId={shopId} money2={money2} onSaved={onSaved} onOpen={() => setDetailId(o.receipt_id)} />
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

function OrderRow({ o, shopId, money2, onSaved, onOpen }: { o: FinOrderCost; shopId: number; money2: Intl.NumberFormat; onSaved: () => void; onOpen: () => void }) {
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
      <td className="py-2 pr-3 text-right">{money2.format(o.total)}</td>
      <td className="py-2 pr-3 text-right">
        {undefinedItems && o.override === null ? <span className="text-xs text-amber-600">maliyet yok</span> : money2.format(o.auto_cost)}
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
      <td className="w-28 py-2 pr-2">
        <StateMark state={state} message={message} />
      </td>
    </tr>
  );
}

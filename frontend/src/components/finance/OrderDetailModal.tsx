"use client";

import { useEffect, useState } from "react";
import { api, FinOrderDetail } from "@/lib/api";

const names = new Intl.DisplayNames(["tr"], { type: "region", fallback: "code" });
const box = "rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900";

function Row({ label, value, bold, muted }: { label: string; value: React.ReactNode; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 text-sm ${bold ? "font-semibold" : ""} ${muted ? "text-neutral-500" : ""}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Etsy'nin sipariş ayrıntı ekranına benzer pencere: "Sipariş detayları" ve "Kazanç" sekmeleri. */
export default function OrderDetailModal({ shopId, receiptId, onClose }: { shopId: number; receiptId: number; onClose: () => void }) {
  const [data, setData] = useState<FinOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"details" | "earnings">("earnings");

  useEffect(() => {
    let cancelled = false;
    api.finance
      .orderDetail(shopId, receiptId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, receiptId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loading = !data || data.receipt_id !== receiptId;
  const money = (n: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: data?.currency ?? "USD", minimumFractionDigits: 2 }).format(n);
  const signed = (n: number) => (n < 0 ? `−${money(-n)}` : money(n));
  const e = data?.earnings;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onMouseDown={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-neutral-50 shadow-xl dark:bg-neutral-950" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Sipariş #{receiptId}</h2>
            {data && !loading && (
              <p className="text-sm text-neutral-500">
                {data.buyer} · {data.created.slice(0, 10)} · {data.status}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Kapat" className="rounded-full p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800">
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-neutral-200 px-6 dark:border-neutral-800">
          {(
            [
              ["details", "Sipariş detayları"],
              ["earnings", "Kazanç"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${tab === v ? "border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="space-y-4 px-6 py-5">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {loading && !error && <p className="text-sm text-neutral-400">Yükleniyor…</p>}

          {data && !loading && e && tab === "earnings" && (
            <>
              <p className="text-base text-neutral-700 dark:text-neutral-200">
                Bu siparişten kazancınız <b className="text-emerald-700 dark:text-emerald-400">{money(e.earned)}</b>
                {!e.has_ledger && <span className="ml-2 text-xs text-amber-600">(Etsy ücret kaydı henüz indirilmedi, ücretler 0 görünüyor)</span>}
              </p>

              <section className={box}>
                <Row label="Alıcının ödediği" value={money(e.buyer_paid)} bold />
                <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                  <Row label="Ürün fiyatı" value={money(e.items_price)} muted />
                  {e.discount > 0 && <Row label="Mağaza indirimi" value={`−${money(e.discount)}`} muted />}
                  {e.shipping > 0 && <Row label="Kargo" value={money(e.shipping)} muted />}
                  {e.gift_wrap > 0 && <Row label="Hediye paketi" value={money(e.gift_wrap)} muted />}
                  <Row label="Ara toplam" value={money(e.subtotal)} muted />
                  <Row label="Vergi öncesi toplam" value={money(e.before_tax)} muted />
                  <Row label="Alıcının ödediği vergi" value={money(e.tax_paid)} muted />
                </div>
              </section>

              <section className={box}>
                <Row label="Ücretler ve kesintiler" value={<span className="text-red-600">{signed(e.fees_total)}</span>} bold />
                <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                  {e.fees.length === 0 && <p className="py-1 text-sm text-neutral-400">Kayıt yok</p>}
                  {e.fees.map((f, i) => (
                    <Row
                      key={i}
                      label={f.label}
                      value={
                        <span title={`${f.original.toFixed(2)} ${f.original_currency}`}>
                          {signed(f.amount)}
                          {f.original_currency && f.original_currency !== data.currency && (
                            <span className="ml-2 text-[11px] text-neutral-400">
                              {f.original.toFixed(2)} {f.original_currency}
                            </span>
                          )}
                        </span>
                      }
                      muted
                    />
                  ))}
                </div>
              </section>

              <section className={box}>
                <Row label="Maliyet ve kâr" value="" bold />
                <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                  <Row label="Kazanç (Etsy sonrası)" value={money(e.earned)} muted />
                  {e.refunds.map((r, i) => (
                    <Row key={i} label={`İade${r.reason ? ` · ${r.reason}` : ""}`} value={`−${money(r.amount)}`} muted />
                  ))}
                  <Row
                    label={`Ürün + kargo maliyeti${e.cost_manual ? " (elle girilmiş)" : ""}`}
                    value={e.cost > 0 ? `−${money(e.cost)}` : <span className="text-amber-600">girilmemiş</span>}
                    muted
                  />
                  <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                    <Row label="Net kâr" value={<span className={e.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}>{money(e.profit)}</span>} bold />
                  </div>
                </div>
              </section>

              {e.fx && e.fees.some((f) => f.original_currency && f.original_currency !== data.currency) && (
                <p className="text-xs text-neutral-400">
                  Etsy ücretleri {e.fees.find((f) => f.original_currency)?.original_currency} olarak kesilir. Burada bu siparişin ödeme kuruyla (1 {data.currency} = {e.fx.toFixed(2)}{" "}
                  {e.fees.find((f) => f.original_currency)?.original_currency}) çevrilir; Etsy ekranındaki tutarlardan yaklaşık %1 farklı görünebilir.
                </p>
              )}
            </>
          )}

          {data && !loading && tab === "details" && (
            <>
              <section className={box}>
                <Row label="Sipariş no" value={data.receipt_id} muted />
                <Row label="Sipariş zamanı" value={data.created.replace("T", " ").slice(0, 16)} muted />
                <Row label="Durum" value={data.status} muted />
                <Row label="Tahmini gönderim" value={data.expected_ship ?? "—"} muted />
                <Row label="Alıcı" value={data.buyer || "—"} muted />
                {data.is_gift && <Row label="Hediye" value={data.gift_message || "Evet"} muted />}
              </section>

              <section className={box}>
                <h3 className="mb-1 text-sm font-semibold">Teslimat adresi</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  {data.address.name}
                  {data.address.lines.map((l, i) => (
                    <span key={i}>
                      <br />
                      {l}
                    </span>
                  ))}
                  <br />
                  {[data.address.city, data.address.state, data.address.zip].filter(Boolean).join(", ")}
                  <br />
                  {data.address.country_iso ? (names.of(data.address.country_iso) ?? data.address.country_iso) : ""}
                </p>
                {data.shipments.length > 0 && (
                  <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                    Kargo: {data.shipments.map((s) => `${s.carrier} ${s.tracking}`.trim()).join(", ")}
                  </p>
                )}
              </section>

              {data.buyer_message && (
                <section className={box}>
                  <h3 className="mb-1 text-sm font-semibold">Alıcının notu</h3>
                  <p className="whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">{data.buyer_message}</p>
                </section>
              )}

              <section className={box}>
                <h3 className="mb-2 text-sm font-semibold">Ürünler ({data.items.length})</h3>
                <div className="space-y-3">
                  {data.items.map((it) => (
                    <div key={it.transaction_id ?? it.title} className="flex gap-3">
                      {it.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image} alt="" className="h-16 w-16 flex-shrink-0 rounded object-cover" />
                      ) : (
                        <div className="h-16 w-16 flex-shrink-0 rounded bg-neutral-100 dark:bg-neutral-800" />
                      )}
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-medium">{it.title}</div>
                        {it.variations.map((v, i) => (
                          <div key={i} className="text-xs text-neutral-500">
                            {v.name}: {v.value}
                          </div>
                        ))}
                        <div className="mt-0.5 text-xs text-neutral-400">
                          {it.quantity} adet · {money(it.price)}
                          {it.sku && ` · SKU ${it.sku}`}
                          {it.transaction_id && ` · İşlem ${it.transaction_id}`}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-medium">{money(it.price * it.quantity)}</div>
                        <div className="text-[11px] text-neutral-400">{it.cost_defined ? `maliyet ${money(it.unit_cost * it.quantity)}` : "maliyet yok"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api, FinOrderDetail } from "@/lib/api";
import ProductThumb from "./ProductThumb";
import { tNow as t } from "@/lib/i18n";

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
  const names = new Intl.DisplayNames([t("tr", "en")], { type: "region", fallback: "code" });
  const money = (n: number) =>
    new Intl.NumberFormat(t("tr-TR", "en-US"), { style: "currency", currency: data?.currency ?? "USD", minimumFractionDigits: 2 }).format(n);
  const signed = (n: number) => (n < 0 ? `−${money(-n)}` : money(n));
  const e = data?.earnings;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onMouseDown={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-neutral-50 shadow-xl dark:bg-neutral-950" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("Sipariş", "Order")} #{receiptId}</h2>
            {data && !loading && (
              <p className="text-sm text-neutral-500">
                {data.buyer} · {data.created.slice(0, 10)} · {data.status}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label={t("Kapat", "Close")} className="rounded-full p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800">
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-neutral-200 px-6 dark:border-neutral-800">
          {(
            [
              ["details", t("Sipariş detayları", "Order details")],
              ["earnings", t("Kazanç", "Earnings")],
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
          {loading && !error && <p className="text-sm text-neutral-400">{t("Yükleniyor…", "Loading…")}</p>}

          {data && !loading && e && tab === "earnings" && (
            <>
              <p className="text-base text-neutral-700 dark:text-neutral-200">
                {t("Bu siparişten kazancınız", "Your earnings from this order")} <b className="text-emerald-700 dark:text-emerald-400">{money(e.earned)}</b>
                {!e.has_ledger && (
                  <span className="ml-2 text-xs text-amber-600">
                    {t("(Etsy ücret kaydı henüz indirilmedi, ücretler 0 görünüyor)", "(Etsy fee records not downloaded yet, fees show as 0)")}
                  </span>
                )}
              </p>

              <section className={box}>
                <Row label={t("Alıcının ödediği", "Buyer paid")} value={money(e.buyer_paid)} bold />
                <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                  <Row label={t("Ürün fiyatı", "Item price")} value={money(e.items_price)} muted />
                  {e.discount > 0 && <Row label={t("Mağaza indirimi", "Shop discount")} value={`−${money(e.discount)}`} muted />}
                  {e.shipping > 0 && <Row label={t("Kargo", "Shipping")} value={money(e.shipping)} muted />}
                  {e.gift_wrap > 0 && <Row label={t("Hediye paketi", "Gift wrap")} value={money(e.gift_wrap)} muted />}
                  <Row label={t("Ara toplam", "Subtotal")} value={money(e.subtotal)} muted />
                  <Row label={t("Vergi öncesi toplam", "Total before tax")} value={money(e.before_tax)} muted />
                  <Row label={t("Alıcının ödediği vergi", "Tax paid by buyer")} value={money(e.tax_paid)} muted />
                </div>
              </section>

              <section className={box}>
                <Row label={t("Ücretler ve kesintiler", "Fees and deductions")} value={<span className="text-red-600">{signed(e.fees_total)}</span>} bold />
                <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                  {e.fees.length === 0 && <p className="py-1 text-sm text-neutral-400">{t("Kayıt yok", "No records")}</p>}
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
                <Row label={t("Maliyet ve kâr", "Cost and profit")} value="" bold />
                <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                  <Row label={t("Kazanç (Etsy sonrası)", "Earnings (after Etsy)")} value={money(e.earned)} muted />
                  {e.refunds.map((r, i) => (
                    <Row key={i} label={`${t("İade", "Refund")}${r.reason ? ` · ${r.reason}` : ""}`} value={`−${money(r.amount)}`} muted />
                  ))}
                  {!e.cost_manual && e.fixed_cost > 0 && <Row label={t("  Sipariş başına sabit gider (dahil)", "  Fixed cost per order (included)")} value={money(e.fixed_cost)} muted />}
                  <Row
                    label={`${t("Ürün + kargo maliyeti", "Item + shipping cost")}${e.cost_manual ? t(" (elle girilmiş)", " (entered manually)") : ""}`}
                    value={e.cost > 0 ? `−${money(e.cost)}` : <span className="text-amber-600">{t("girilmemiş", "not entered")}</span>}
                    muted
                  />
                  <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                    <Row label={t("Net kâr", "Net profit")} value={<span className={e.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}>{money(e.profit)}</span>} bold />
                  </div>
                </div>
              </section>

              {data.original_currency !== data.currency && (
                <p className="text-xs text-neutral-400">
                  {t(
                    `Bu sipariş ${data.original_currency} ile verildi (${data.original_total.toFixed(2)} ${data.original_currency}). Tüm tutarlar rapor para birimi ${data.currency} cinsinden gösteriliyor; ödeme hesabı üzerinden çevrilir.`,
                    `This order was placed in ${data.original_currency} (${data.original_total.toFixed(2)} ${data.original_currency}). All amounts are shown in the report currency ${data.currency}, converted via the payment account.`,
                  )}
                </p>
              )}
              {e.fx && e.fees.some((f) => f.original_currency && f.original_currency !== data.currency) && (
                <p className="text-xs text-neutral-400">
                  {t(
                    `Etsy ücretleri ${e.fees.find((f) => f.original_currency)?.original_currency} olarak kesilir. Burada bu siparişin ödeme kuruyla (1 ${data.currency} = ${e.fx.toFixed(2)} ${e.fees.find((f) => f.original_currency)?.original_currency}) çevrilir; Etsy ekranındaki tutarlardan yaklaşık %1 farklı görünebilir.`,
                    `Etsy fees are charged in ${e.fees.find((f) => f.original_currency)?.original_currency}. Here they are converted at this order's payment rate (1 ${data.currency} = ${e.fx.toFixed(2)} ${e.fees.find((f) => f.original_currency)?.original_currency}), so they may differ by about 1% from Etsy's screen.`,
                  )}
                </p>
              )}
            </>
          )}

          {data && !loading && tab === "details" && (
            <>
              <section className={box}>
                <Row label={t("Sipariş no", "Order no.")} value={data.receipt_id} muted />
                <Row label={t("Sipariş zamanı", "Order time")} value={data.created.replace("T", " ").slice(0, 16)} muted />
                <Row label={t("Durum", "Status")} value={data.status} muted />
                <Row label={t("Tahmini gönderim", "Estimated ship date")} value={data.expected_ship ?? "—"} muted />
                <Row label={t("Alıcı", "Buyer")} value={data.buyer || "—"} muted />
                {data.is_gift && <Row label={t("Hediye", "Gift")} value={data.gift_message || t("Evet", "Yes")} muted />}
              </section>

              <section className={box}>
                <h3 className="mb-1 text-sm font-semibold">{t("Teslimat adresi", "Shipping address")}</h3>
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
                    {t("Kargo", "Shipping")}: {data.shipments.map((s) => `${s.carrier} ${s.tracking}`.trim()).join(", ")}
                  </p>
                )}
              </section>

              {data.buyer_message && (
                <section className={box}>
                  <h3 className="mb-1 text-sm font-semibold">{t("Alıcının notu", "Note from buyer")}</h3>
                  <p className="whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">{data.buyer_message}</p>
                </section>
              )}

              <section className={box}>
                <h3 className="mb-2 text-sm font-semibold">{t("Ürünler", "Items")} ({data.items.length})</h3>
                <div className="space-y-3">
                  {data.items.map((it) => (
                    <div key={it.transaction_id ?? it.title} className="flex gap-3">
                      <ProductThumb src={it.image} size={64} />
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-medium">{it.title}</div>
                        {it.variations.map((v, i) => (
                          <div key={i} className="text-xs text-neutral-500">
                            {v.name}: {v.value}
                          </div>
                        ))}
                        <div className="mt-0.5 text-xs text-neutral-400">
                          {it.quantity} {t("adet", "pcs")} · {money(it.price)}
                          {it.sku && ` · SKU ${it.sku}`}
                          {it.transaction_id && ` · ${t("İşlem", "Transaction")} ${it.transaction_id}`}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-medium">{money(it.price * it.quantity)}</div>
                        <div className="text-[11px] text-neutral-400">{it.cost_defined ? `${t("maliyet", "cost")} ${money(it.unit_cost * it.quantity)}` : t("maliyet yok", "no cost")}</div>
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

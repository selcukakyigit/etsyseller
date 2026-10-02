"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/listing-editor/Modal";
import { api, FinOrderDetail } from "@/lib/api";
import { tNow as t } from "@/lib/i18n";

const KIND: Record<string, [string, string]> = {
  nakliye: ["Nakliye", "Freight"],
  "gümrük": ["Gümrük", "Customs"],
  "ek hizmet": ["Ek hizmet", "Extra service"],
  "diğer": ["Diğer", "Other"],
};
const kindLabel = (k: string) => (KIND[k] ? t(...KIND[k]) : k);
const row = "flex items-start justify-between gap-3 border-b border-neutral-100 py-1.5 text-sm last:border-0 dark:border-neutral-800";

/** Siparişin maliyetinin tam dökümü: ürün maliyeti, kargo kalemleri (faturalardan), sipariş başına sabit gider ve toplam. */
export default function OrderCostBreakdown({
  shopId,
  receiptId,
  money2,
  onClose,
}: {
  shopId: number;
  receiptId: number;
  money2: Intl.NumberFormat;
  onClose: () => void;
}) {
  const [d, setD] = useState<FinOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.finance.orderDetail(shopId, receiptId).then(setD).catch((e) => setError(e instanceof Error ? e.message : t("Yüklenemedi", "Could not load")));
  }, [shopId, receiptId]);

  const e = d?.earnings;
  const shipTotal = d ? d.items.reduce((sum, i) => sum + i.cost_parts.ship * i.quantity, 0) : 0;

  return (
    <Modal title={d ? `${t("Sipariş maliyeti", "Order cost")} · ${d.buyer}` : t("Sipariş maliyeti", "Order cost")} widthClass="max-w-xl" z={120} onClose={onClose}>
      <div className="text-left" onClick={(ev) => ev.stopPropagation()}>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!d && !error && <p className="text-sm text-neutral-400">{t("Yükleniyor…", "Loading…")}</p>}
        {d && e && (
          <>
            <p className="mb-1 text-xs font-semibold text-neutral-500">{t("Ürünler", "Items")}</p>
            <div className="mb-4">
              {d.items.map((i, idx) => {
                const productCost = (i.cost_parts.unit + i.cost_parts.pct) * i.quantity;
                const ship = i.cost_parts.ship * i.quantity;
                return (
                  <div key={i.transaction_id ?? idx} className={row}>
                    <div className="min-w-0">
                      <div className="line-clamp-1">
                        {i.quantity}× {i.title}
                      </div>
                      <div className="text-[11px] text-neutral-400">{i.variations.map((v) => v.value).join(" · ")}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-neutral-500">
                      <div>{t("Ürün", "Item")}: {money2.format(productCost)}</div>
                      <div className={ship === 0 && !i.is_digital ? "text-amber-600 dark:text-amber-400" : ""}>
                        {t("Kargo", "Shipping")}: {money2.format(ship)}
                        {i.cost_parts.ship_source === "fatura" && t(" (faturadan)", " (from invoice)")}
                        {i.cost_parts.ship_source === "elle" && t(" (elle girilen)", " (entered manually)")}
                        {ship === 0 && !i.is_digital && t(" · fatura yok", " · no invoice")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {e.shipping_lines.length > 0 && (
              <>
                <p className="mb-1 text-xs font-semibold text-sky-700 dark:text-sky-400">{t("Kargo fatura kalemleri", "Shipping invoice lines")} ({e.shipping_lines.length})</p>
                <div className="mb-4">
                  {e.shipping_lines.map((l) => (
                    <div key={l.id} className={row}>
                      <div>
                        {l.description || kindLabel(l.kind)}
                        <div className="text-[11px] text-neutral-400">
                          {kindLabel(l.kind)} · {l.invoice_no || l.source_filename} · {l.invoice_date}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {money2.format(l.amount)}
                        <div className="text-[11px] text-neutral-400">
                          {l.original_currency} {l.original_amount.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-950">
              <div className="flex justify-between py-0.5">
                <span className="text-neutral-500">{t("Ürün maliyeti", "Item cost")}</span>
                <span>{money2.format(d.items.reduce((sum, i) => sum + (i.cost_parts.unit + i.cost_parts.pct) * i.quantity, 0))}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-neutral-500">{t("Kargo (nakliye + gümrük + ek hizmet)", "Shipping (freight + customs + extras)")}</span>
                <span>{money2.format(shipTotal)}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-neutral-500">{t("Sipariş başına sabit gider", "Fixed cost per order")}</span>
                <span>{money2.format(e.fixed_cost)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-neutral-200 pt-1.5 font-semibold dark:border-neutral-800">
                <span>{t("Otomatik maliyet", "Automatic cost")}</span>
                <span>{money2.format(e.auto_cost)}</span>
              </div>
              {e.cost_manual && (
                <div className="flex justify-between py-0.5 text-amber-700 dark:text-amber-400">
                  <span>{t("Elle girilen gerçek maliyet (geçerli)", "Manually entered real cost (in effect)")}</span>
                  <span>{money2.format(e.cost)}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-neutral-200 pt-1.5 dark:border-neutral-800">
                <span className="text-neutral-500">{t("Kazanç (Etsy sonrası) − maliyet", "Earnings (after Etsy) − cost")}</span>
                <span className={`font-semibold ${e.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{money2.format(e.profit)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

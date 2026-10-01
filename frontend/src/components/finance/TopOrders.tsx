"use client";

import { useState } from "react";
import { FinOrderBrief } from "@/lib/api";
import OrderCostBreakdown from "./OrderCostBreakdown";

/**
 * Genel bakış: dönemdeki en çok kazandıran / en düşük kârlı (zarar) siparişler. Satıra tıklayınca o siparişin
 * maliyet dökümü açılır. Sipariş kârı = satış − iade − Etsy ücreti − maliyet (reklam/abonelik gibi ortak giderler hariç).
 */
export default function TopOrders({
  rows,
  shopId,
  money2,
  countryName,
  emptyText,
}: {
  rows: FinOrderBrief[];
  shopId: number;
  money2: Intl.NumberFormat;
  countryName: (iso: string) => string;
  emptyText: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (rows.length === 0) return <p className="text-sm text-neutral-400">{emptyText}</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Müşteri</th>
              <th className="py-2 pr-3 font-medium">Ürün</th>
              <th className="py-2 pr-3 text-right font-medium">Satış</th>
              <th className="py-2 pr-3 text-right font-medium">Maliyet</th>
              <th className="py-2 pr-3 text-right font-medium">Kâr</th>
              <th className="py-2 text-right font-medium">Marj</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => (
              <tr
                key={o.receipt_id}
                onClick={() => setOpen(o.receipt_id)}
                title="Maliyet dökümü için tıkla"
                className="cursor-pointer border-b border-neutral-50 last:border-0 hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/40"
              >
                <td className="py-2 pr-3 text-neutral-400">{i + 1}</td>
                <td className="py-2 pr-3">
                  <div className="font-medium">{o.buyer || "—"}</div>
                  <div className="text-[11px] text-neutral-400">
                    {o.date}
                    {o.country ? ` · ${countryName(o.country)}` : ""}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <div className="line-clamp-1 max-w-xs">{o.title}</div>
                  {o.item_count > 1 && <div className="text-[11px] text-neutral-400">+{o.item_count - 1} ürün daha</div>}
                </td>
                <td className="py-2 pr-3 text-right">{money2.format(o.sales)}</td>
                <td className="py-2 pr-3 text-right text-neutral-500">
                  {money2.format(o.cogs)}
                  {!o.cost_defined && <div className="text-[11px] text-amber-600 dark:text-amber-400">maliyet girilmemiş</div>}
                </td>
                <td className={`py-2 pr-3 text-right font-semibold ${o.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{money2.format(o.profit)}</td>
                <td className={`py-2 text-right ${o.margin >= 0 ? "text-neutral-500" : "text-red-600 dark:text-red-400"}`}>%{o.margin.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open !== null && <OrderCostBreakdown shopId={shopId} receiptId={open} money2={money2} onClose={() => setOpen(null)} />}
    </>
  );
}

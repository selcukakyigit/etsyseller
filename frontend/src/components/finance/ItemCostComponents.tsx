"use client";

import { FinOrderDetail } from "@/lib/api";

/** Siparişin ürün maliyetinin, sipariş tarihindeki bileşenleri (kesim, ambalaj, boya…): her kalem için satır satır, adetle çarpılmış tutarlar.
 * Bileşeni olmayan (elle girilmiş maliyetli) kalem gösterilmez. Sipariş maliyeti penceresi ve sipariş detayı aynı bileşeni kullanır. */
export default function ItemCostComponents({ items, money }: { items: FinOrderDetail["items"]; money: (n: number) => string }) {
  const withParts = items.filter((i) => i.cost_parts.components.length > 0);
  if (withParts.length === 0) return null;
  return (
    <div className="mb-1 ml-3 border-l border-neutral-200 pl-3 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
      {withParts.map((i, idx) => (
        <div key={i.transaction_id ?? idx} className="py-0.5">
          {items.length > 1 && <div className="line-clamp-1 text-neutral-600 dark:text-neutral-300">{i.quantity}× {i.title}</div>}
          {i.cost_parts.components.map((c) => (
            <div key={c.label} className="flex justify-between gap-4">
              <span>{c.label}</span>
              <span>{money(c.amount * i.quantity)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

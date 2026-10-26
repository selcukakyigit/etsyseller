"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n-client";
import { packLabel } from "../core/materials";
import { money, unitLabel } from "../core/units";
import { muted } from "../core/ui";
import { num, StockForm } from "./StockFields";

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Fiyatı paket başına yazma: kalemde paket miktarı (ör. 20 tabaka, 100 m) varsa fiyat alanı "paket fiyatı" olabilir; kayıtta `toUnit` ile birim fiyata
 * bölünür (fiyat listesi hep kalemin birimi başınadır). Geçişte yazılı sayı da çevrilir. */
export function usePackPrice(stock: StockForm, price: string, setPrice: (v: string) => void) {
  const size = num(stock.pack_size);
  const available = size !== null && Number.isFinite(size) && size > 0;
  const [perPack, setPerPack] = useState(false);
  const on = available && perPack;
  function toggle(next: boolean) {
    const p = num(price);
    if (available && p !== null && Number.isFinite(p)) setPrice(String(round4(next ? p * size : p / size)));
    setPerPack(next);
  }
  return { available, on, toggle, size: size ?? 0, toUnit: (p: number) => (on ? round4(p / (size ?? 1)) : p) };
}

export type PackPrice = ReturnType<typeof usePackPrice>;

/** Fiyat alanının altı: "paket başına yaz" anahtarı ve karşılığı ("= 20 ₺ / tabaka" ya da "= 400 ₺ / paket"). */
export default function PackPriceNote({ pack, stock, unit, price, currency }: { pack: PackPrice; stock: StockForm; unit: string; price: string; currency: string }) {
  const { t, locale } = useT();
  if (!pack.available) return null;
  const p = num(price);
  const valid = p !== null && Number.isFinite(p) && p >= 0;
  const name = packLabel(stock.pack_unit, t);
  return (
    <div className="mt-1.5 space-y-0.5">
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
        <input type="checkbox" checked={pack.on} onChange={(e) => pack.toggle(e.target.checked)} className="accent-[#D97757]" />
        {t(`Fiyatı ${name} başına yaz`, `Enter the price per ${name}`)}
      </label>
      {valid && (
        <span className={muted}>
          {pack.on ? `= ${money(pack.toUnit(p), currency, locale)} / ${unitLabel(unit, t)}` : `= ${money(p * pack.size, currency, locale)} / ${name}`}
        </span>
      )}
    </div>
  );
}

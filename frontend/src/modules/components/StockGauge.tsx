"use client";

import { useT } from "@/lib/i18n-client";
import { PriceItem } from "../core/api";
import { qty, unitLabel } from "../core/units";

type Tone = "green" | "amber" | "red";

const TONES: Record<Tone, { bar: string; text: string }> = {
  green: { bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  amber: { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  red: { bar: "bg-red-500", text: "text-red-700 dark:text-red-400" },
};

const badge = "rounded-full bg-red-100 px-1.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300";

/** Stok göstergesi rengi: sunucu "low/out" derse kırmızı; "ok" iken en az stoğun iki katına (en az stok yoksa son alımın %25'ine) inmişse sarı. */
export function stockTone(item: PriceItem): Tone {
  const on = item.on_hand ?? 0;
  if (item.level === "out" || item.level === "low") return "red";
  const warn = item.min_stock ? item.min_stock * 2 : (item.ref ?? 0) * 0.25;
  return on <= warn ? "amber" : "green";
}

/** Kalem satırında küçük stok göstergesi: dolu oranı çubuğu, eldeki miktar (paket miktarı varsa paket karşılığı) ve bitti/azaldı rozeti. */
export default function StockGauge({ item }: { item: PriceItem }) {
  const { t, locale } = useT();
  if (!item.track_stock || item.on_hand === undefined) return null;
  const tone = TONES[stockTone(item)];
  const ref = Math.max(item.ref ?? 0, item.on_hand, 1e-9);
  const pct = item.level === "out" ? 0 : Math.max(4, Math.min(100, (item.on_hand / ref) * 100));
  const packs = item.pack_size ? item.on_hand / item.pack_size : null;
  return (
    <div className="mt-1 flex items-center gap-2" title={t("Eldeki stok", "Stock on hand")}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] font-medium ${tone.text}`}>
        {qty(item.on_hand, locale)} {unitLabel(item.unit, t)}
        {packs !== null && ` (≈ ${qty(packs, locale)} ${t("paket", "packs")})`}
      </span>
      {item.level === "out" && <span className={badge}>{t("Bitti", "Out")}</span>}
      {item.level === "low" && <span className={badge}>{t("Azaldı", "Low")}</span>}
    </div>
  );
}

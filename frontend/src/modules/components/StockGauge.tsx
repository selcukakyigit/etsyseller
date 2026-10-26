"use client";

import { useT } from "@/lib/i18n-client";
import { PriceItem } from "../core/api";
import { packLabel } from "../core/materials";
import { money, qty, unitLabel } from "../core/units";

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
function StockGauge({ item, onClick }: { item: PriceItem; onClick?: () => void }) {
  const { t, locale } = useT();
  if (!item.track_stock || item.on_hand === undefined) return null;
  const tone = TONES[stockTone(item)];
  const ref = Math.max(item.ref ?? 0, item.on_hand, 1e-9);
  const pct = item.level === "out" ? 0 : Math.max(4, Math.min(100, (item.on_hand / ref) * 100));
  const packs = item.pack_size ? item.on_hand / item.pack_size : null;
  return (
    <div
      className={`mt-1 flex items-center gap-2 ${onClick ? "cursor-pointer" : ""}`}
      title={onClick ? t("Stok penceresini aç", "Open the stock window") : t("Eldeki stok", "Stock on hand")}
      onClick={onClick}
    >
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] font-medium ${tone.text}`}>
        {qty(item.on_hand, locale)} {unitLabel(item.unit, t)}
        {packs !== null && ` (≈ ${qty(packs, locale)} ${packLabel(item.pack_unit, t)})`}
        {item.on_hand_metres != null && ` (≈ ${qty(item.on_hand_metres, locale)} m)`}
      </span>
      {item.level === "out" && <span className={badge}>{t("Bitti", "Out")}</span>}
      {item.level === "low" && <span className={badge}>{t("Azaldı", "Low")}</span>}
    </div>
  );
}

/** Malzeme satırının stok bölümü (yalnızca üye): "Stok takibi" anahtarı; açıksa gösterge, ortalama maliyet ve stok penceresine geçiş. Kapatmak onay ister
 * (üst bileşen sorar); kapalıyken anahtar tek başına görünür. */
export default function StockLine({ item, currency, onOpen, onToggle }: { item: PriceItem; currency: string; onOpen: () => void; onToggle: (on: boolean) => void }) {
  const { t, locale } = useT();
  const on = !!item.track_stock;
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t("Stok takibi", "Track stock")}
          onClick={() => onToggle(!on)}
          className={`relative h-4 w-7 shrink-0 rounded-full transition ${on ? "bg-[#D97757]" : "bg-neutral-300 dark:bg-neutral-600"}`}
        >
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
        </button>
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{on ? t("Stok takibi açık", "Stock tracking on") : t("Stok takibi kapalı", "Stock tracking off")}</span>
        {on && item.avg_cost != null && (
          <span className="text-[11px] text-neutral-400">
            · {t("ort. maliyet", "avg. cost")} {money(item.avg_cost, currency, locale)} / {unitLabel(item.unit, t)}
          </span>
        )}
      </div>
      {on && <StockGauge item={item} onClick={onOpen} />}
    </div>
  );
}

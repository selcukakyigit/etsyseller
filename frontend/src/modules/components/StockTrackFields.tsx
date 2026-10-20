"use client";

import HelpTip from "@/components/ui/HelpTip";
import DecimalInput from "@/components/ui/NumberInputs";
import { useT } from "@/lib/i18n-client";
import { PriceItem, TrackingPatch } from "../core/api";
import { input, label } from "../core/ui";
import { unitLabel } from "../core/units";

/** Kalemin stok ayarları (formda metin): takip kutusu, paket miktarı, en az stok, (yeni kalemde) açılış stoğu. Miktarlar kalemin biriminde. */
export type TrackForm = { track: boolean; pack: string; min: string; opening: string };

export const emptyTrack: TrackForm = { track: false, pack: "", min: "", opening: "" };

const text = (n: number | null | undefined) => (n == null ? "" : String(n));

export const trackOf = (item: PriceItem): TrackForm => ({ track: !!item.track_stock, pack: text(item.pack_size), min: text(item.min_stock), opening: "" });

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

/** Sunucuya gidecek stok ayarları; `from` verilirse yalnızca değişenler. Geçersiz sayı varsa null. */
export function trackPayload(form: TrackForm, from?: TrackForm): TrackingPatch | null {
  const out: TrackingPatch = {};
  if (!from || form.track !== from.track) out.track_stock = form.track;
  for (const [key, field, positive] of [["pack_size", "pack", true], ["min_stock", "min", false]] as const) {
    if (from && form[field] === from[field]) continue;
    const v = num(form[field]);
    if (v !== null && !(Number.isFinite(v) && (positive ? v > 0 : v >= 0))) return null;
    if (v !== null || from) out[key] = v;
  }
  return out;
}

export default function StockTrackFields({ value, unit, onChange, showOpening }: { value: TrackForm; unit: string; onChange: (v: TrackForm) => void; showOpening?: boolean }) {
  const { t } = useT();
  const u = unitLabel(unit, t);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
        <input type="checkbox" checked={value.track} onChange={(e) => onChange({ ...value, track: e.target.checked })} className="h-4 w-4 accent-[#D97757]" />
        {t("Stok takibi", "Track stock")}
        <HelpTip>
          {t(
            "Açıksa bu kalemin eldeki miktarı tutulur: alımları sen girersin, işler onaylanınca kullanılan miktar kendiliğinden düşer. Kesimcinin getirdiği malzemede kapalı bırak.",
            "When on, this item's quantity on hand is tracked: you enter purchases, and jobs take the used quantity off when confirmed. Leave it off for material the cutter supplies.",
          )}
        </HelpTip>
      </label>
      {value.track && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={label}>
              {t("Paket miktarı", "Pack size")} ({u}){" "}
              <HelpTip>{t("Bir paketteki miktar: strafor paketi 20 adet, streç rulosu 2 kg. Doluysa alımı “30 paket” diye girebilirsin.", "The quantity in one pack: a styrofoam pack of 20 pieces, a stretch roll of 2 kg. When set, you can enter purchases as “30 packs”.")}</HelpTip>
            </span>
            <DecimalInput value={value.pack} onValue={(v) => onChange({ ...value, pack: v })} placeholder="—" className={`${input} w-full`} />
          </label>
          <label className="block">
            <span className={label}>
              {t("En az stok", "Minimum stock")} ({u}){" "}
              <HelpTip>{t("Eldeki miktar bunun altına inince kalem kırmızı görünür. Boşsa son alımın %10'u kullanılır.", "The item turns red when the quantity on hand falls to this level. When empty, 10% of the last purchase is used.")}</HelpTip>
            </span>
            <DecimalInput value={value.min} onValue={(v) => onChange({ ...value, min: v })} placeholder="—" className={`${input} w-full`} />
          </label>
          {showOpening && (
            <label className="block">
              <span className={label}>
                {t("Başlangıç stoğu", "Opening stock")} ({u}){" "}
                <HelpTip>{t("Şu an elinde olan miktar. Fiyat listesindeki fiyatla değerlenir; fiyatlı alımları sonradan “Stok” penceresinden girersin.", "What you have right now. It is valued at the price-list price; enter priced purchases later from the “Stock” window.")}</HelpTip>
              </span>
              <DecimalInput value={value.opening} onValue={(v) => onChange({ ...value, opening: v })} placeholder="0" className={`${input} w-full`} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

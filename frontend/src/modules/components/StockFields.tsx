"use client";

import { useT } from "@/lib/i18n-client";
import { PriceItem, StockPatch } from "../core/api";
import { isSheetMaterial, MATERIAL_TYPES } from "../core/materials";
import DecimalInput from "./DecimalInput";
import { input, label, muted } from "../core/ui";

/** Form durumu: sayılar metin olarak tutulur (boş = girilmemiş). */
export type StockForm = { material: string; thickness_mm: string; plate_width: string; plate_height: string; plate_kg: string; roll_width: string; film_um: string; roll_length: string };

export const emptyStock: StockForm = { material: "", thickness_mm: "", plate_width: "", plate_height: "", plate_kg: "", roll_width: "", film_um: "", roll_length: "" };

const text = (n: number | null | undefined) => (n == null ? "" : String(n));

/** Film kalınlığı sunucuda mikron; balonlu naylon mm ile söylenir (4 mm), streç ve poşet mikronla (23). Formda türün birimiyle durur. */
export const filmDivisor = (material: string): number => (material === "bubble" ? 1000 : 1);
const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6);

export const stockOf = (item: PriceItem): StockForm => ({
  material: item.material ?? "",
  thickness_mm: text(item.thickness_mm),
  plate_width: text(item.plate_width),
  plate_height: text(item.plate_height),
  plate_kg: text(item.plate_kg),
  roll_width: text(item.roll_width),
  film_um: item.film_um == null ? "" : fmt(item.film_um / filmDivisor(item.material ?? "")),
  roll_length: text(item.roll_length),
});

const NUMBERS = ["thickness_mm", "plate_width", "plate_height", "plate_kg", "roll_width", "film_um", "roll_length"] as const;
const PLATE_NUMBERS = ["thickness_mm", "plate_width", "plate_height", "plate_kg"] as const;
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

/** Formdan sunucuya gidecek alanlar; `from` verilirse yalnızca değişenler. Geçersiz sayı varsa null döner. */
export function stockPayload(form: StockForm, from?: StockForm): StockPatch | null {
  const out: StockPatch = {};
  if (!from || form.material !== from.material) out.material = form.material || null;
  for (const k of NUMBERS) {
    if (from && form[k] === from[k] && !(k === "film_um" && form.material !== from.material)) continue;
    const v = num(form[k]);
    if (v !== null && !(Number.isFinite(v) && v > 0)) return null;
    if (v !== null || from) out[k] = v !== null && k === "film_um" ? v * filmDivisor(form.material) : v;
  }
  return out;
}

const FILM_TYPES = ["stretch", "bubble", "bag"];
const ROLL_TYPES = ["tape", "stretch", "bubble", "paper", "other"];

/** Hangi alanlar gösterilir: BİRİME göre. Plaka (tabaka) fiyatında kalınlık ve plaka boyutu/ağırlığı gerekir; kg/g/ton ve m² fiyatında
 * yalnızca levha malzemede (metal, ahşap, akrilik) kalınlık (ve kg'da plaka bilgisi, "hesaplanan plaka fiyatı" için) anlamlıdır; adet, uzunluk
 * birimlerinde (kutu, çıta, streç metresi, toz boya) yalnızca tür sorulur. Türü seçilmemiş kalemde daha önce girilmiş değer
 * varsa görünür kalır. */
export function stockFields(unit: string, form: StockForm): { thickness: boolean; plate: boolean; film: boolean; roll: boolean } {
  const sheetLike = isSheetMaterial(form.material) || (form.material === "" && PLATE_NUMBERS.some((k) => form[k] !== ""));
  const film = ["kg", "g", "t"].includes(unit) && FILM_TYPES.includes(form.material); // streç/naylon: en × kalınlık → kg/m
  const roll = unit === "piece" && ROLL_TYPES.includes(form.material); // bant rulosu gibi: rulo boyu → adet/m
  const rolls = { film, roll };
  if (unit === "sheet") return { thickness: true, plate: true, ...rolls };
  if (["kg", "g", "t"].includes(unit)) return { thickness: sheetLike, plate: sheetLike, ...rolls };
  if (["m2", "cm2"].includes(unit)) return { thickness: sheetLike, plate: false, ...rolls };
  if (["ml", "l", "m3"].includes(unit)) return { thickness: true, plate: false, ...rolls }; // hacim fiyatı: alan × kalınlık hacmi verir
  return { thickness: false, plate: false, ...rolls };
}

/** Birim ya da tür değişince artık gösterilmeyen alanların değerlerini temizler (gizli değer sunucuya gitmesin). */
export function pruneStock(form: StockForm, unit: string): StockForm {
  const f = stockFields(unit, form);
  return {
    ...form,
    thickness_mm: f.thickness ? form.thickness_mm : "",
    ...(f.plate ? {} : { plate_width: "", plate_height: "", plate_kg: "" }),
    ...(f.film ? {} : { roll_width: "", film_um: "" }),
    ...(f.roll ? {} : { roll_length: "" }),
  };
}

/** Malzeme kalemi alanları: tür her zaman; kalınlık ve plaka bilgisi birime göre (bkz. `stockFields`). Fiyat kg ya da plaka (tabaka) olarak
 * girilir, diğeri plaka ağırlığından türetilir; ürünün malzeme maliyeti plakadaki alan payından hesaplanır. */
export default function StockFields({ value, unit, onChange }: { value: StockForm; unit: string; onChange: (v: StockForm) => void }) {
  const { t } = useT();
  const set = (patch: Partial<StockForm>) => onChange(pruneStock({ ...value, ...patch }, unit));
  const num = (key: Exclude<keyof StockForm, "material">, text: string, placeholder: string) => (
    <label className="block">
      <span className={label}>{text}</span>
      <DecimalInput value={value[key] ?? ""} onValue={(text) => set({ [key]: text })} placeholder={placeholder} className={`${input} w-full`} />
    </label>
  );
  const show = stockFields(unit, value);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className={label}>{t("Malzeme türü", "Material type")}</span>
          <select value={value.material} onChange={(e) => set({ material: e.target.value })} className={`${input} w-full`}>
            <option value="">—</option>
            {MATERIAL_TYPES.map(([key, tr, en]) => (
              <option key={key} value={key}>
                {t(tr, en)}
              </option>
            ))}
          </select>
        </label>
        {show.thickness && num("thickness_mm", t("Kalınlık (mm)", "Thickness (mm)"), "2")}
        {show.plate && num("plate_width", t("Plaka eni (mm)", "Plate width (mm)"), "1500")}
        {show.plate && num("plate_height", t("Plaka boyu (mm)", "Plate length (mm)"), "3000")}
        {show.plate && num("plate_kg", t("Plaka ağırlığı (kg)", "Plate weight (kg)"), t("boşsa hesaplanır", "auto if empty"))}
        {show.film && num("roll_width", t("Rulo eni (mm)", "Roll width (mm)"), "500")}
        {show.film && (value.material === "bubble" ? num("film_um", t("Kalınlık (mm)", "Thickness (mm)"), "4") : num("film_um", t("Kalınlık (mikron)", "Thickness (micron)"), "23"))}
        {show.roll && num("roll_length", t("Rulo boyu (m)", "Roll length (m)"), "100")}
      </div>
      {(show.film || show.roll) && (
        <p className={`${muted} mt-1.5`}>
          {t(
            "İsteğe bağlı. Girilirse paket formüllerinde bu kalemin miktarı metre olarak yazılır; fiyat kg ya da rulo fiyatından hesaplanır.",
            "Optional. When filled in, package formulas give this item's quantity in metres; the price is worked out from the kg or roll price.",
          )}
        </p>
      )}
      {show.plate && (
        <p className={`${muted} mt-1.5`}>
          {t(
            "İsteğe bağlı. Plaka boyutu varsa ürünün malzemesi plakadaki alan payından, yoksa ağırlığından hesaplanır.",
            "Optional. With a plate size the product’s material comes from its area share of the plate, otherwise from its weight.",
          )}
        </p>
      )}
    </div>
  );
}

"use client";

import HelpTip from "@/components/ui/HelpTip";
import DecimalInput from "@/components/ui/NumberInputs";
import { useT } from "@/lib/i18n-client";
import { MaterialCatalog, PriceItem, StockPatch } from "../core/api";
import { materialGroup, useMaterialCatalog } from "../core/materials";
import { input, label } from "../core/ui";

/** Form durumu: sayılar metin olarak tutulur (boş = girilmemiş). `material` tür anahtarıdır (türü seçen alan formun kendisinde, bkz. MaterialTypeSelect). */
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

type NumberKey = Exclude<keyof StockForm, "material">;
const NUMBERS: NumberKey[] = ["thickness_mm", "plate_width", "plate_height", "plate_kg", "roll_width", "film_um", "roll_length"];
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

/** Bu tür ve birimle sorulan alanlar: kural backend'de (`materials.fields_for`), katalogla gelir. Tür bilinmiyorsa (türü seçilmemiş eski kalem)
 * daha önce girilmiş değerler görünür kalır. */
export function visibleFields(catalog: MaterialCatalog | null, form: StockForm, unit: string): string[] {
  const group = materialGroup(form.material);
  return group && catalog ? (catalog.groups[group].fields[unit] ?? []) : NUMBERS.filter((k) => form[k] !== "");
}

/** Tür grubunda seçilebilen birimler; tür seçilmemişse sınırlama yok (undefined). */
export function allowedUnits(catalog: MaterialCatalog | null, material: string): string[] | undefined {
  const group = materialGroup(material);
  return group && catalog ? catalog.groups[group].units : undefined;
}

/** Artık sorulmayan alanların değerlerini temizler (gizli değer sunucuya gitmesin); tür bilinmiyorsa dokunmaz. */
export function pruneStock(catalog: MaterialCatalog | null, form: StockForm, unit: string): StockForm {
  if (!materialGroup(form.material) || !catalog) return form;
  const keep = visibleFields(catalog, form, unit);
  const out = { ...form };
  for (const k of NUMBERS) if (!keep.includes(k)) out[k] = "";
  return out;
}

/** Tür değişince: birim yeni grupta anlamsızsa grubun ilk birimine geçer, alanlar buna göre temizlenir. */
export function applyType(catalog: MaterialCatalog | null, form: StockForm, unit: string, material: string): { form: StockForm; unit: string } {
  const allowed = allowedUnits(catalog, material);
  const nextUnit = allowed && !allowed.includes(unit) ? allowed[0] : unit;
  return { form: pruneStock(catalog, { ...form, material }, nextUnit), unit: nextUnit };
}

/** Kalem formundaki "bilgi eksik" kontrolü için: maliyet ve ürün eşleşmesi için gerekenler (backend `materials.missing` ile aynı kural, kayıt sırasında
 * sunucu da doğrular). Boş döner = tamam. */
export function missingFields(catalog: MaterialCatalog | null, form: StockForm, unit: string): string[] {
  if (!form.material) return ["material"];
  if (materialGroup(form.material) !== "sheet" || !catalog) return [];
  const out: string[] = [];
  if (!form.thickness_mm.trim()) out.push("thickness_mm");
  if (unit === "sheet" && !(form.plate_width.trim() && form.plate_height.trim())) out.push("plate");
  return out;
}

export function useMissingLabels(): (keys: string[]) => string {
  const { t } = useT();
  const names: Record<string, string> = {
    material: t("malzeme türü", "material type"),
    thickness_mm: t("kalınlık", "thickness"),
    plate: t("plaka eni ve boyu", "plate width and length"),
  };
  return (keys) => keys.map((k) => names[k] ?? k).join(", ");
}

/** Malzeme kalemi alanları: yalnızca türün grubunun ve birimin gerektirdikleri (bkz. `visibleFields`). Fiyat kg ya da plaka (tabaka) olarak girilir,
 * diğeri plaka ağırlığından türetilir; ürünün malzeme maliyeti plakadaki alan payından hesaplanır. */
export default function StockFields({ value, unit, onChange }: { value: StockForm; unit: string; onChange: (v: StockForm) => void }) {
  const { t } = useT();
  const catalog = useMaterialCatalog();
  const show = visibleFields(catalog, value, unit);
  if (show.length === 0) return null;
  const field = (key: NumberKey, text: string, placeholder: string) =>
    show.includes(key) && (
      <label key={key} className="block">
        <span className={label}>{text}</span>
        <DecimalInput value={value[key]} onValue={(v) => onChange({ ...value, [key]: v })} placeholder={placeholder} className={`${input} w-full`} />
      </label>
    );
  const isPlate = show.includes("plate_width");
  const isFilm = show.includes("roll_width") || show.includes("roll_length");
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("thickness_mm", t("Kalınlık (mm)", "Thickness (mm)"), "2")}
        {field("plate_width", t("Plaka eni (mm)", "Plate width (mm)"), "1500")}
        {field("plate_height", t("Plaka boyu (mm)", "Plate length (mm)"), "3000")}
        {field("plate_kg", t("Plaka ağırlığı (kg)", "Plate weight (kg)"), t("boşsa hesaplanır", "auto if empty"))}
        {field("roll_width", t("Rulo eni (mm)", "Roll width (mm)"), "500")}
        {field("film_um", value.material === "bubble" ? t("Kalınlık (mm)", "Thickness (mm)") : t("Kalınlık (mikron)", "Thickness (micron)"), value.material === "bubble" ? "4" : "23")}
        {field("roll_length", t("Rulo boyu (m)", "Roll length (m)"), "100")}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <HelpTip>
          {isFilm
            ? t(
                "İsteğe bağlı. Girilirse paket formüllerinde bu kalemin miktarı metre olarak yazılır; fiyat kg ya da rulo fiyatından hesaplanır.",
                "Optional. When filled in, package formulas give this item's quantity in metres; the price is worked out from the kg or roll price.",
              )
            : isPlate
              ? t(
                  "Plaka boyutu varsa ürünün malzemesi plakadaki alan payından, yoksa ağırlığından ya da hacminden hesaplanır. Tabaka fiyatında kalınlık ve plaka boyutu gerekir.",
                  "With a plate size the product’s material comes from its area share of the plate, otherwise from its weight or volume. A per-sheet price needs thickness and plate size.",
                )
              : t("Bu alanlar isteğe bağlıdır.", "These fields are optional.")}
        </HelpTip>
      </div>
    </div>
  );
}

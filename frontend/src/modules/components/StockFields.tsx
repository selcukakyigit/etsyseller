"use client";

import HelpTip from "@/components/ui/HelpTip";
import DecimalInput from "@/components/ui/NumberInputs";
import { useT } from "@/lib/i18n-client";
import { MaterialCatalog, PriceItem, StockPatch } from "../core/api";
import { materialGroup, useMaterialCatalog } from "../core/materials";
import { input, label } from "../core/ui";
import { unitLabel } from "../core/units";

/** Form durumu: sayılar metin olarak tutulur (boş = girilmemiş). `material` tür anahtarıdır (türü seçen alan formun kendisinde, bkz. MaterialTypeSelect). */
export type StockForm = {
  material: string;
  thickness_mm: string;
  plate_width: string;
  plate_height: string;
  plate_kg: string;
  roll_width: string;
  film_um: string;
  roll_length: string;
  /** Alış paketi: türü (katalogdaki `packs` anahtarı) ve paketteki miktar (kalemin biriminde). Tür grubundan bağımsızdır. */
  pack_unit: string;
  pack_size: string;
};

export const emptyStock: StockForm = { material: "", thickness_mm: "", plate_width: "", plate_height: "", plate_kg: "", roll_width: "", film_um: "", roll_length: "", pack_unit: "", pack_size: "" };

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
  pack_unit: item.pack_unit ?? "",
  pack_size: text(item.pack_size),
});

type NumberKey = Exclude<keyof StockForm, "material" | "pack_unit" | "pack_size">;
const NUMBERS: NumberKey[] = ["thickness_mm", "plate_width", "plate_height", "plate_kg", "roll_width", "film_um", "roll_length"];
export const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

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
  // Alış paketi: miktar yazılıp tür seçilmediyse "paket" sayılır; miktar boşsa tür de boşalır.
  const size = num(form.pack_size);
  if (size !== null && !(Number.isFinite(size) && size > 0)) return null;
  const kind = size === null ? "" : form.pack_unit || "pack";
  if (!from) {
    if (size !== null) Object.assign(out, { pack_size: size, pack_unit: kind });
  } else if (form.pack_size !== from.pack_size || kind !== from.pack_unit) {
    Object.assign(out, { pack_size: size, pack_unit: kind || null });
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
    <div className="space-y-3">
      {show.length > 0 && (
        <div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {field("thickness_mm", t("Kalınlık (mm)", "Thickness (mm)"), "2")}
            {field("plate_width", t("Plaka eni (mm)", "Plate width (mm)"), "1500")}
            {field("plate_height", t("Plaka boyu (mm)", "Plate length (mm)"), "3000")}
            {field(
          "plate_kg",
          isFilm ? t("Rulo ağırlığı (kg)", "Roll weight (kg)") : t("Plaka ağırlığı (kg)", "Plate weight (kg)"),
          isFilm ? t("ör. 14", "e.g. 14") : t("boşsa hesaplanır", "auto if empty"),
        )}
            {field("roll_width", t("Rulo eni (mm)", "Roll width (mm)"), "500")}
            {field("film_um", value.material === "bubble" ? t("Kalınlık (mm)", "Thickness (mm)") : t("Kalınlık (mikron)", "Thickness (micron)"), value.material === "bubble" ? "4" : "23")}
            {field("roll_length", t("Rulo boyu (m)", "Roll length (m)"), "100")}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <HelpTip>
              {isFilm
                ? t(
                    "Stok rulo (adet) ya da kg olarak tutulur; paket formüllerinde miktar metre yazılır. Bant gibi boyu belli olan rulo için rulo boyunu yaz; balonlu naylon ve streç için rulo ağırlığı, en ve kalınlığı yaz, uzunluğu sistem hesaplar (kayıttan sonra satırda görünür).",
                    "Stock is kept in rolls (pieces) or kg; package formulas give the quantity in metres. For a roll with a known length (tape) enter the roll length; for bubble wrap and stretch film enter the roll weight, width and thickness and the length is worked out (shown on the row after saving).",
                  )
                : isPlate && materialGroup(value.material) === "piece"
                  ? t(
                      "Tabaka ölçüsü ambalaj paketlerinde kullanılır: ürünün alanı tabaka alanına bölünerek kaç tabaka gideceği hesaplanır (ör. 1200×600). Ölçü yoksa o paket satırı hesaplanamaz.",
                      "The sheet size is used in packaging recipes: the product's area is divided by the sheet area to work out how many sheets are needed (e.g. 1200×600). Without a size that recipe line cannot be calculated.",
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
      )}
      <PackFields value={value} unit={unit} onChange={onChange} />
    </div>
  );
}

/** Alış paketi: malzemeyi hangi ambalajla aldığın ve paketin içindeki miktar (strafor paketi 20 tabaka, koli bandı rulosu 100 m). Doluysa fiyat paket
 * başına da yazılabilir (birim fiyatı sistem bölerek bulur) ve stok girişi paketle yapılabilir. Tüm malzeme türlerinde sorulur. */
function PackFields({ value, unit, onChange }: { value: StockForm; unit: string; onChange: (v: StockForm) => void }) {
  const { t } = useT();
  const catalog = useMaterialCatalog();
  return (
    <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="block">
        <span className={label}>
          {t("Alış paketi", "Purchase pack")}{" "}
          <HelpTip>
            {t(
              "Malzemeyi hangi ambalajla satın aldığın. Paketin içindeki miktarı da yazarsan fiyatı paket başına girebilirsin (birim fiyatı sistem hesaplar) ve stok alımını “30 paket” diye girebilirsin. Paketle almıyorsan boş bırak.",
              "How you buy this material. With the quantity inside the pack you can enter the price per pack (the unit price is worked out) and enter stock purchases as “30 packs”. Leave empty if you do not buy by the pack.",
            )}
          </HelpTip>
        </span>
        <select value={value.pack_unit} onChange={(e) => onChange({ ...value, pack_unit: e.target.value })} className={`${input} w-full`}>
          <option value="">{t("Paketle almıyorum", "Not bought in packs")}</option>
          {(catalog?.packs ?? []).map((p) => (
            <option key={p.key} value={p.key}>
              {t(p.tr, p.en)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={label}>
          {t("Paketteki miktar", "Quantity per pack")} ({unitLabel(unit, t)})
        </span>
        <DecimalInput value={value.pack_size} onValue={(v) => onChange({ ...value, pack_size: v })} placeholder={t("ör. 20", "e.g. 20")} className={`${input} w-full`} />
      </label>
    </div>
  );
}

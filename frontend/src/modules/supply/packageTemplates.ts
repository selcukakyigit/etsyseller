import { PriceItem } from "../core/api";

/** Hazır paket şablonları: boş tariften başlamak yorucu olmasın. Şablon satırındaki `hint`, tedarikçinin fiyat listesindeki malzeme kalemini adından
 * kendiliğinden seçer (bulunamazsa kullanıcı seçer). Miktar = sabit + a × uzun kenar + b × kısa kenar + c × alan (metre ve m²). */
export interface TemplateLine {
  hint: string[];
  constant?: number;
  per_long?: number;
  per_short?: number;
  per_area?: number;
}

export interface PackageTemplate {
  id: string;
  tr: string;
  en: string;
  lines: TemplateLine[];
}

export const PACKAGE_TEMPLATES: PackageTemplate[] = [
  { id: "frame", tr: "Ahşap çerçeve", en: "Wooden frame", lines: [{ hint: ["çıta", "cita", "ahşap", "ahsap"], per_long: 3, per_short: 2 }] },
  {
    id: "pallet",
    tr: "Palet",
    en: "Pallet",
    lines: [
      { hint: ["palet", "pallet"], constant: 1 },
      { hint: ["torba", "streç", "strec", "poşet", "poset"], per_long: 4, per_short: 4 },
    ],
  },
  { id: "box", tr: "Kutu", en: "Box", lines: [{ hint: ["kutu", "box"], constant: 1 }] },
  {
    id: "wrap",
    tr: "Streç + balonlu",
    en: "Stretch + bubble wrap",
    lines: [
      { hint: ["streç", "strec"], per_long: 6, per_short: 6 },
      { hint: ["balonlu"], per_area: 2.4 },
    ],
  },
  {
    id: "cardboard",
    tr: "Karton plaka",
    en: "Cardboard sheets",
    lines: [
      { hint: ["karton"], per_area: 2.2 },
      { hint: ["bant"], per_long: 2, per_short: 2 },
      { hint: ["işçilik", "iscilik", "birleştirme", "birlestirme"], constant: 1 },
    ],
  },
];

/** Şablon satırının ipucuna uyan ilk malzeme/hizmet kalemi (yoksa null). */
export function matchItem(hint: string[], items: PriceItem[]): PriceItem | null {
  const lower = (s: string) => s.toLocaleLowerCase("tr");
  return items.find((i) => hint.some((h) => lower(i.name).includes(lower(h)))) ?? null;
}

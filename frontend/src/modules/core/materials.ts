/** Malzeme türleri (backend/app/modkit/materials.py MATERIALS): [anahtar, Türkçe ad, İngilizce ad, levha mı]. Levha malzemeler (metal, ahşap,
 * akrilik) ürünün parçası olur; kalınlık ve plaka boyutu yalnızca onlarda anlamlıdır. Ambalaj ve sarf türleri yalnızca fiyat listesindedir. */
export const MATERIAL_TYPES: [string, string, string, boolean][] = [
  ["dkp", "DKP / siyah sac", "Mild steel (DKP)", true],
  ["aluminium", "Alüminyum", "Aluminium", true],
  ["stainless", "Paslanmaz", "Stainless steel", true],
  ["chrome", "Krom", "Chrome", true],
  ["galvanized", "Galvaniz", "Galvanized", true],
  ["copper", "Bakır", "Copper", true],
  ["brass", "Pirinç", "Brass", true],
  ["wood", "Ahşap / MDF", "Wood / MDF", true],
  ["acrylic", "Akrilik", "Acrylic", true],
  ["cardboard", "Karton", "Cardboard", false],
  ["paper", "Kâğıt", "Paper", false],
  ["bag", "Poşet", "Bag", false],
  ["box", "Kutu", "Box", false],
  ["stretch", "Streç film", "Stretch film", false],
  ["bubble", "Balonlu naylon", "Bubble wrap", false],
  ["styrofoam", "Strafor", "Styrofoam", false],
  ["tape", "Bant", "Tape", false],
  ["powder_paint", "Toz boya", "Powder paint", false],
  ["other", "Diğer", "Other", false],
];

export const isSheetMaterial = (key: string | null): boolean => MATERIAL_TYPES.some((m) => m[0] === key && m[3]);

export const materialLabel = (key: string | null, t: (tr: string, en: string) => string): string => {
  const m = MATERIAL_TYPES.find((x) => x[0] === key);
  return m ? t(m[1], m[2]) : "";
};

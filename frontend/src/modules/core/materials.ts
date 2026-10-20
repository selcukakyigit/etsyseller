import { useSyncExternalStore } from "react";
import type { EntityApi, MaterialCatalog, MaterialGroup, MaterialTypeInfo } from "./api";

/** Açık kayıt sayfasının malzeme kataloğu (yerleşik + kullanıcı türleri). Tek kaynak backend'dir (`material_types.catalog`); burada yalnızca
 * tutulur. Etiket ve grup sorguları senkron çalışsın (render sırasında) diye modül düzeyinde durur; sayfa `useMaterialCatalog` ile abone olur. */
let current: MaterialCatalog | null = null;
let types = new Map<string, MaterialTypeInfo>();
const listeners = new Set<() => void>();

function publish(catalog: MaterialCatalog | null) {
  current = catalog;
  types = new Map((catalog?.types ?? []).map((x) => [x.key, x]));
  listeners.forEach((l) => l());
}

/** Kataloğu sunucudan tazeler (sayfa açılınca, tür eklenince ya da silinince); `null` verilirse (sayfadan çıkınca) boşaltır. */
export async function refreshMaterialCatalog(api: EntityApi, entityId: number): Promise<MaterialCatalog> {
  const catalog = await api.materialTypes.list(entityId);
  publish(catalog);
  return catalog;
}

export const clearMaterialCatalog = () => publish(null);

/** Kataloğa abone olur: katalog gelince ya da değişince bileşen yeniden çizilir. */
export function useMaterialCatalog(): MaterialCatalog | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}

export const materialType = (key: string | null | undefined): MaterialTypeInfo | undefined => (key ? types.get(key) : undefined);
export const materialGroup = (key: string | null | undefined): MaterialGroup | null => materialType(key)?.group ?? null;
export const isSheetMaterial = (key: string | null | undefined): boolean => materialGroup(key) === "sheet";

export const materialLabel = (key: string | null | undefined, t: (tr: string, en: string) => string): string => {
  const m = materialType(key);
  return m ? t(m.tr, m.en) : "";
};

/** Grupların ad ve açıklamaları (tür eklerken seçilir). */
export const GROUP_INFO: Record<MaterialGroup, { tr: string; en: string; hintTr: string; hintEn: string }> = {
  sheet: {
    tr: "Levha / plaka",
    en: "Sheet / plate",
    hintTr: "Metal, ahşap, akrilik gibi plaka halinde alınıp kesilen malzeme. Kalınlık, plaka ebadı ve yoğunluk sorulur; ürünün malzemesi olarak seçilebilir.",
    hintEn: "Material bought as plates and cut, like metal, wood or acrylic. Asks for thickness, plate size and density; can be picked as a product's material.",
  },
  film: {
    tr: "Rulo / film",
    en: "Roll / film",
    hintTr: "Streç, balonlu naylon, bant gibi rulo malzeme. Rulo eni, kalınlığı ya da rulo boyu sorulur.",
    hintEn: "Rolled material like stretch film, bubble wrap or tape. Asks for roll width, thickness or roll length.",
  },
  piece: {
    tr: "Adetle sayılan",
    en: "Counted by piece",
    hintTr: "Kutu, karton, strafor gibi tek tek sayılan malzeme. Ek alan sorulmaz.",
    hintEn: "Material counted one by one, like boxes, cardboard or styrofoam. No extra fields.",
  },
  bulk: {
    tr: "Dökme / diğer",
    en: "Bulk / other",
    hintTr: "Toz boya gibi kg ya da litreyle alınan malzeme. Ek alan sorulmaz.",
    hintEn: "Material bought by weight or volume, like powder paint. No extra fields.",
  },
};

export type VarValue = {
  name: string;
  value_id: number | null;
  image_id: number | null;
};

export type VarProperty = {
  property_id: number;
  property_name: string;
  scale_id: number | null;
  values: VarValue[];
  linkPhotos: boolean;
};

// Fiyat/stok hangi varyasyon(lar)a göre değişiyor; [] = değişmiyor.
export type VarSettings = {
  price: number[];
  quantity: number[];
  skuVaries: boolean;
  readinessVaries: boolean;
};

// Etsy'nin özel (serbest isimli) varyasyon property id'leri.
export const CUSTOM_IDS = [513, 514, 516];
export const MAX_PROPERTIES = 3;

// Etsy ürün (kombinasyon) limitleri: 1 varyasyon 70, 2 varyasyon 4900, 3 varyasyon 2500;
// bir *_on_property alanı tüm varyasyonlara bağlıysa (2+ varyasyon) 400.
export function maxCombos(propertyCount: number, anyVariesByAll: boolean): number {
  if (propertyCount >= 2 && anyVariesByAll) return 400;
  if (propertyCount >= 3) return 2500;
  if (propertyCount === 2) return 4900;
  return 70;
}

// Etsy kuralları: her *_on_property alanı boş, tek özellik veya tüm özellikler olabilir;
// biri tüm özellikleri içeriyorsa diğerleri de boş ya da tüm özellikler olmalı.
export function settingsProblem(propertyCount: number, s: VarSettings): string | null {
  if (propertyCount < 2) return null;
  const lengths = [
    s.price.length,
    s.quantity.length,
    s.skuVaries ? propertyCount : 0,
    s.readinessVaries ? propertyCount : 0,
  ];
  if (lengths.some((n) => n > 1 && n < propertyCount)) {
    return "Bir alan yalnızca tek varyasyona ya da tüm varyasyonlara bağlı olabilir.";
  }
  if (lengths.includes(propertyCount) && lengths.some((n) => n !== 0 && n !== propertyCount)) {
    return "Etsy: bir alan tüm varyasyonlara bağlıysa fiyat, stok, SKU ve işlem profili ya kapalı ya da tüm varyasyonlara bağlı olmalı.";
  }
  return null;
}

export const isCustom = (id: number) => CUSTOM_IDS.includes(id);

export function comboCount(props: VarProperty[]) {
  return props.reduce((n, p) => n * Math.max(p.values.length, 1), props.length ? 1 : 0);
}

// Etsy değerlerde parantez kabul etmiyor.
export const cleanName = (s: string) => s.replace(/[()]/g, "").trim();

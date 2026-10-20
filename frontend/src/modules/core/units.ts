import type { T } from "@/lib/i18n-client";

/** Backend'deki birim kodları (backend/app/modkit/units.py) ve iki dilli adları. */
export const UNIT_GROUPS: { key: string; tr: string; en: string; units: string[] }[] = [
  { key: "time", tr: "Süre", en: "Time", units: ["s", "min", "h"] },
  { key: "count", tr: "Sayı", en: "Count", units: ["piece", "sheet"] },
  { key: "mass", tr: "Ağırlık", en: "Weight", units: ["g", "kg", "t"] },
  { key: "length", tr: "Uzunluk", en: "Length", units: ["mm", "cm", "m"] },
  { key: "area", tr: "Alan", en: "Area", units: ["cm2", "m2"] },
  { key: "volume", tr: "Hacim", en: "Volume", units: ["ml", "l", "m3"] },
];

const NAMES: Record<string, [string, string]> = {
  s: ["sn", "sec"],
  min: ["dk", "min"],
  h: ["saat", "hour"],
  piece: ["adet", "piece"],
  sheet: ["tabaka", "sheet"],
  g: ["g", "g"],
  kg: ["kg", "kg"],
  t: ["ton", "ton"],
  mm: ["mm", "mm"],
  cm: ["cm", "cm"],
  m: ["m", "m"],
  cm2: ["cm²", "cm²"],
  m2: ["m²", "m²"],
  ml: ["ml", "ml"],
  l: ["litre", "liter"],
  m3: ["m³", "m³"],
  job: ["iş", "job"],
  pack: ["paket", "pack"], // yalnızca stok girişinde (kalemin paket miktarı); birim listelerinde yok
};

export function unitLabel(code: string, t: T): string {
  const n = NAMES[code];
  return n ? t(n[0], n[1]) : code;
}

/** "180 ₺ / dk" gibi birim fiyat. */
export function perUnit(price: string, code: string, t: T): string {
  return code === "job" ? price : `${price} / ${unitLabel(code, t)}`;
}

export function money(n: number | null | undefined, currency: string, locale: string): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** Para biriminin kısa simgesi ("₺", "$", "€"); bilinmiyorsa kodun kendisi. */
export function currencySymbol(currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

export function qty(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n);
}

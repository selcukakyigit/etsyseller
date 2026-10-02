export type Lang = "en" | "tr";
export const LANG_COOKIE = "ulagg_lang";

export function parseLang(value: string | null | undefined): Lang | null {
  return value === "tr" || value === "en" ? value : null;
}

/** Ziyaretçinin ülkesine göre (Vercel: x-vercel-ip-country): Türkiye'den Türkçe, diğer her yerden İngilizce. */
export function langFromCountry(country: string | null | undefined): Lang | null {
  if (!country) return null;
  return country.toUpperCase() === "TR" ? "tr" : "en";
}

export const COUNTRY_HEADER = "x-vercel-ip-country";

/** Tarayıcı dil listesinin ilkine göre varsayılan: Türkçe değilse İngilizce. */
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  return (header ?? "").trim().toLowerCase().startsWith("tr") ? "tr" : "en";
}

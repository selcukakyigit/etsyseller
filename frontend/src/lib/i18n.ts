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

/** Hook kullanılamayan yerler (yardımcı fonksiyonlar, API hataları, bildirimler) için: o anki dile göre metni seçer.
 * Tarayıcıda dil çerezine, o yoksa tarayıcı diline bakar; sunucuda İngilizce döner. */
export function tNow(tr: string, en: string): string {
  if (typeof document === "undefined") return en;
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  const lang = parseLang(m ? decodeURIComponent(m[1]) : null) ?? langFromAcceptLanguage(navigator.language);
  return lang === "tr" ? tr : en;
}

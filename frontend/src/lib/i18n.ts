export type Lang = "en" | "tr";
export const LANG_COOKIE = "ulagg_lang";

export function parseLang(value: string | null | undefined): Lang | null {
  return value === "tr" || value === "en" ? value : null;
}

/** Tarayıcı dil listesinin ilkine göre varsayılan: Türkçe değilse İngilizce. */
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  return (header ?? "").trim().toLowerCase().startsWith("tr") ? "tr" : "en";
}

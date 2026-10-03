/** Sıra takibi için seçilebilen ülkeler: Etsy'nin en büyük pazarları. Ad, arayüz dilinde `Intl.DisplayNames` ile üretilir. */
export const RANK_COUNTRIES = ["US", "GB", "CA", "AU", "DE", "FR", "NL", "IT", "ES", "IE", "BE", "AT", "CH", "SE", "DK", "NO", "FI", "NZ", "JP", "TR"] as const;

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

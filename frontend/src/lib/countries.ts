import { tNow } from "@/lib/i18n";

/** Sıra takibi için seçilebilen ülkeler: Etsy'nin en büyük pazarları. Ad, arayüz dilinde `Intl.DisplayNames` ile üretilir. */
export const RANK_COUNTRIES = ["US", "GB", "CA", "AU", "DE", "FR", "NL", "IT", "ES", "IE", "BE", "AT", "CH", "SE", "DK", "NO", "FI", "NZ", "JP", "TR"] as const;

const cache: Record<string, Intl.DisplayNames> = {};

/** Ülke kodunun adı (varsayılan: arayüz dili). Uygulamanın bütün ülke adı gösterimleri bunu kullanır: `Intl.DisplayNames.of` yapısı geçersiz bir kodda
 * ("??" gibi, ülkesi bilinmeyen siparişler) `fallback` verilse bile RangeError fırlatıp sayfayı düşürür; burada kodun kendisi döner. */
export function countryName(code: string | null | undefined, locale: string = tNow("tr", "en")): string {
  if (!code) return "";
  try {
    return (cache[locale] ??= new Intl.DisplayNames([locale], { type: "region", fallback: "code" })).of(code) ?? code;
  } catch {
    return code;
  }
}

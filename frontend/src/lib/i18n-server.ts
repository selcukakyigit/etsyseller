import { cookies, headers } from "next/headers";
import { COUNTRY_HEADER, Lang, LANG_COOKIE, langFromAcceptLanguage, langFromCountry, parseLang } from "@/lib/i18n";

/** Sunucu bileşenleri için dil: çerez (kullanıcı seçtiyse) → ülke (Türkiye ise Türkçe) → tarayıcı dili (yerelde). */
export async function getLang(): Promise<Lang> {
  const chosen = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  if (chosen) return chosen;
  const h = await headers();
  return langFromCountry(h.get(COUNTRY_HEADER)) ?? langFromAcceptLanguage(h.get("accept-language"));
}

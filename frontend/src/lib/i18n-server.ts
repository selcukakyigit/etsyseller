import { cookies, headers } from "next/headers";
import { Lang, LANG_COOKIE, langFromAcceptLanguage, parseLang } from "@/lib/i18n";

/** Sunucu bileşenleri için dil: çerez (kullanıcı seçtiyse) → tarayıcı dili → İngilizce. */
export async function getLang(): Promise<Lang> {
  const chosen = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  if (chosen) return chosen;
  return langFromAcceptLanguage((await headers()).get("accept-language"));
}

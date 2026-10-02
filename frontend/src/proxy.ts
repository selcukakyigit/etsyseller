import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COUNTRY_HEADER, LANG_COOKIE, langFromCountry, parseLang } from "@/lib/i18n";

/** İlk ziyarette dili ülkeye göre seçer ve çereze yazar: Türkiye'den Türkçe, diğer her yerden İngilizce.
 * İstemci bileşenleri ülke başlığını göremediği için çerez şart; kullanıcı EN/TR seçiciyle değiştirebilir. */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (parseLang(request.cookies.get(LANG_COOKIE)?.value)) return response;
  const lang = langFromCountry(request.headers.get(COUNTRY_HEADER));
  if (lang) response.cookies.set(LANG_COOKIE, lang, { path: "/", maxAge: 31536000, sameSite: "lax" });
  return response;
}

export const config = {
  matcher: ["/((?!_next/|api/|.*\..*).*)"],
};

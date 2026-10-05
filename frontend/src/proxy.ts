import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COUNTRY_HEADER, LANG_COOKIE, langFromCountry, parseLang } from "@/lib/i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
// Erişim belirteci çerezi (bkz. lib/supabase.ts syncCookie).
const TOKEN_COOKIE = "ulagg_at";
// Var olmayan bir yol: buraya yeniden yazılan istek, normal 404 sayfasını (app/not-found.tsx) 404 koduyla gösterir.
const NOT_FOUND_PATH = "/__not-found";

/** Yönetim paneli sunucuda kapılanır: çerezdeki belirteç backend'e sorulur, yönetici değilse (giriş yok, belirteç
 * geçersiz, backend'e ulaşılamadı) sayfa hiç gönderilmez, düz 404 döner. Giriş sayfasına da yönlendirilmez ki
 * dışarıdan bakan için /admin herhangi bir olmayan adresten farksız olsun. Asıl güvenlik backend'dedir
 * (/api/admin/* yönetici olmayana 404); bu kapı yalnızca panelin varlığını gizler. */
async function isAdmin(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const me: { is_admin?: boolean } = await res.json();
    return me.is_admin === true;
  } catch {
    return false;
  }
}

/** İlk ziyarette dili ülkeye göre seçer ve çereze yazar: Türkiye'den Türkçe, diğer her yerden İngilizce.
 * İstemci bileşenleri ülke başlığını göremediği için çerez şart; kullanıcı EN/TR seçiciyle değiştirebilir. */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const adminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const response =
    adminPath && !(await isAdmin(request)) ? NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url)) : NextResponse.next();
  if (parseLang(request.cookies.get(LANG_COOKIE)?.value)) return response;
  const lang = langFromCountry(request.headers.get(COUNTRY_HEADER));
  if (lang) response.cookies.set(LANG_COOKIE, lang, { path: "/", maxAge: 31536000, sameSite: "lax" });
  return response;
}

export const config = {
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
};

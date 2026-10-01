import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

const COOKIE = "ulagg_at";

// Backend, başlık gönderemeyen GET istekleri (<img>, dosya indirme, Etsy'ye bağlanma yönlendirmesi) için erişim
// belirtecini bu çerezden de okur. Değiştiren istekler her zaman Authorization başlığıyla gider.
// Üretimde API ayrı alt alan adındaysa NEXT_PUBLIC_COOKIE_DOMAIN=.alanadi.com ayarla.
function syncCookie(token: string | null, expiresAt?: number) {
  if (typeof document === "undefined") return;
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN ? `; domain=${process.env.NEXT_PUBLIC_COOKIE_DOMAIN}` : "";
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  if (token) {
    const exp = expiresAt ? `; expires=${new Date(expiresAt * 1000).toUTCString()}` : "";
    document.cookie = `${COOKIE}=${token}; path=/; samesite=lax${secure}${domain}${exp}`;
  } else {
    document.cookie = `${COOKIE}=; path=/; max-age=0${domain}`;
  }
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_event, session) => {
    syncCookie(session?.access_token ?? null, session?.expires_at);
  });
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  syncCookie(data.session?.access_token ?? null, data.session?.expires_at);
  return data.session?.access_token ?? null;
}

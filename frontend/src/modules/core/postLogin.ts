/** Girişten (ya da kayıt + e-posta doğrulamasından, Google dönüşünden) sonra dönülecek sayfa. Yalnızca site içi yol
 * kabul edilir: başka bir siteye yönlendirme (open redirect) olamaz. Bir saat sonra geçersizdir. */
const KEY = "postLoginNext";
const TTL = 60 * 60 * 1000;

function safe(path: unknown): string | null {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : null;
}

export function rememberNext(path: string) {
  if (!safe(path)) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {}
}

export function takeNext(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    window.localStorage.removeItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { path?: unknown; at?: number };
    return v.at && Date.now() - v.at < TTL ? safe(v.path) : null;
  } catch {
    return null;
  }
}

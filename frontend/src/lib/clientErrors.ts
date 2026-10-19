import { ApiError } from "@/lib/api";
import { supportApi } from "@/lib/supportApi";
import type { TicketContext } from "@/lib/supportApi";

/** Arayüz hatalarının iki kullanımı var: (1) bellekteki son hatalar, destek talebine bağlam olarak eklenir; (2) beklenmeyen
 * hatalar kullanıcı talep açmasa da sessizce sunucuya bildirilir (yönetici "Hatalar" sayfasında görür). Sunucu aynı hatayı
 * tek satırda toplar; tarayıcı oturum başına en fazla 5 farklı hata gönderir. */
const MAX = 5;
const MAX_REPORTS = 5;
const buffer: string[] = [];
const reported = new Set<string>();
let installed = false;

function push(message: string) {
  buffer.push(`${new Date().toISOString().slice(11, 19)} ${message}`.slice(0, 400));
  if (buffer.length > MAX) buffer.shift();
}

function report(message: string, detail = "") {
  // API'nin döndürdüğü beklenen hatalar (4xx, ağ) kullanıcıya zaten gösterilir; beklenmeyen kod hatası değildir.
  if (reported.has(message) || reported.size >= MAX_REPORTS || !navigator.onLine) return;
  reported.add(message);
  supportApi.reportError({ message: message.slice(0, 400), detail: detail.slice(0, 2000), url: window.location.pathname }).catch(() => {});
}

export function installClientErrorBuffer() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    // Tampondaki metin, sunucuya giden metinle aynı: talepler ile otomatik yakalanan hatalar aynı parmak iziyle eşleşir.
    push(e.message);
    report(e.message, e.error instanceof Error ? (e.error.stack ?? "") : "");
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    if (reason instanceof ApiError) return;
    const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    push(message);
    report(message, reason instanceof Error ? (reason.stack ?? "") : "");
  });
}

/** Sayfada gösterilen hatayı (error.tsx) tampona ekler ve bildirir; "Sorunu bildir" bunu talebe taşır. */
export function recordClientError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  push(message);
  report(message, error instanceof Error ? (error.stack ?? "") : "");
}

export function buildSupportContext(shopName?: string | null): TicketContext {
  return {
    url: window.location.pathname + window.location.search,
    referrer: document.referrer ? new URL(document.referrer).pathname : "",
    user_agent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    lang: document.documentElement.lang || navigator.language,
    shop: shopName ?? "",
    errors: [...buffer],
  };
}

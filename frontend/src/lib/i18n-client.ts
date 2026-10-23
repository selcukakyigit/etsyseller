"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Lang, LANG_COOKIE, langFromAcceptLanguage, parseLang } from "@/lib/i18n";

const EVENT = "ulagg-lang";

function readCookie(): Lang | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  return parseLang(m ? decodeURIComponent(m[1]) : null);
}

export function setLang(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event(EVENT));
}

function snapshot(): Lang {
  return readCookie() ?? langFromAcceptLanguage(navigator.language);
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** İstemci bileşenleri için: çerezdeki dil (proxy.ts ilk ziyarette ülkeye göre yazar), yoksa tarayıcı dili.
 * Sunucuda İngilizce render edilir. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, snapshot, () => "en" as Lang);
}

export type T = (tr: string, en: string) => string;

/** Satır içi çeviri: `t("Siparişler", "Orders")`. Metnin iki dili yan yana durur, ayrı sözlük dosyası yok. */
export function useT(): { t: T; lang: Lang; locale: string } {
  const lang = useLang();
  // `t` ve dönen nesne dile bağlı olarak KARARLIDIR: efekt/useCallback bağımlılıklarına güvenle yazılır (eskiden her render'da yeni bir `t` döndüğü için
  // `[…, t]` bağımlılıklı efektler her render'da yeniden çalışıyordu).
  const t = useCallback<T>((tr, en) => (lang === "tr" ? tr : en), [lang]);
  return useMemo(() => ({ t, lang, locale: lang === "tr" ? "tr-TR" : "en-US" }), [t, lang]);
}

export { tNow } from "@/lib/i18n";

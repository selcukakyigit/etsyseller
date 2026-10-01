"use client";

import { useSyncExternalStore } from "react";
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

/** İstemci bileşenleri için: çerezdeki dil, yoksa tarayıcı dili. Sunucuda İngilizce render edilir. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, snapshot, () => "en" as Lang);
}

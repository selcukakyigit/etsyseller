"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "ulagg-stored-state";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // gizli pencere / engellenmiş depolama: varsayılan kullanılır
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Kullanıcının seçimini (dönem, ülke, sıralama, görünüm…) bu tarayıcıda hatırlayan `useState`. Yalnızca metin değer
 * tutar; sunucuda ve ilk çizimde varsayılan döner, ardından kayıtlı değere geçer (hidrasyon uyumsuzluğu olmaz). */
export function useStoredState<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const storageKey = `ulagg:${key}`;
  const value = useSyncExternalStore(
    subscribe,
    () => read(storageKey),
    () => null,
  );
  const current = value !== null && (!allowed || allowed.includes(value as T)) ? (value as T) : fallback;
  const set = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // depolama yoksa seçim yalnızca bu oturumda kalmaz; sessizce geç
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [storageKey],
  );
  return [current, set];
}

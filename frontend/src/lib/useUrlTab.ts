"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "ulagg-url-tab";

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/**
 * Sekme durumunu URL'in `?tab=` sorgu parametresinde tutar — sayfa yenilenince ya da linki paylaşınca
 * hep başa (ilk sekmeye) dönmesin. Varsayılan sekme URL'e hiç yazılmaz (temiz kalsın); geri/ileri
 * tuşlarıyla da (popstate) senkron kalır. `next/navigation`'ın `useSearchParams`'ı yerine düz
 * `window.location` kullanıyoruz — sayfayı Suspense sınırına almaya gerek kalmasın. URL'i yerel
 * `history.replaceState` ile değiştiririz (Next.js router'a bağlanır, sayfa yeniden yüklenmez, kaydırma değişmez).
 *
 * İlk render sunucuyla AYNI olmalı (varsayılan sekme); aksi halde sekme adını gösteren her yer (ör. "Excel: …"
 * düğmesi) sunucu/istemci hydration uyuşmazlığı verir. URL'deki sekme hidrasyondan hemen sonra okunur.
 */
export function useUrlTab<T extends string>(param: string, def: T, valid: readonly T[] | ((v: string) => boolean)): [T, (t: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(param),
    () => null,
  );
  const tab = raw && (typeof valid === "function" ? valid(raw) : (valid as readonly string[]).includes(raw)) ? (raw as T) : def;

  const setTab = useCallback(
    (next: T) => {
      const url = new URL(window.location.href);
      if (next === def) url.searchParams.delete(param);
      else url.searchParams.set(param, next);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new Event(EVENT));
    },
    [param, def],
  );

  return [tab, setTab];
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Sekme durumunu URL'in `?tab=` sorgu parametresinde tutar — sayfa yenilenince ya da linki paylaşınca
 * hep başa (ilk sekmeye) dönmesin. Varsayılan sekme URL'e hiç yazılmaz (temiz kalsın); geri/ileri
 * tuşlarıyla da (popstate) senkron kalır. `next/navigation`'ın `useSearchParams`'ı yerine düz
 * `window.location` kullanıyoruz — sayfayı Suspense sınırına almaya gerek kalmasın.
 */
export function useUrlTab<T extends string>(param: string, def: T, valid: readonly T[]): [T, (t: T) => void] {
  const router = useRouter();

  const fromUrl = useCallback((): T => {
    if (typeof window === "undefined") return def;
    const v = new URLSearchParams(window.location.search).get(param);
    return v && (valid as readonly string[]).includes(v) ? (v as T) : def;
  }, [param, def, valid]);

  // İlk render sunucuyla AYNI olmalı (varsayılan sekme); aksi halde sekme adını gösteren her yer (ör. "Excel: …"
  // düğmesi) sunucu/istemci hydration uyuşmazlığı verir. URL'deki sekme mount'tan hemen sonra okunur.
  const [tab, setTabState] = useState<T>(def);
  useEffect(() => {
    setTabState(fromUrl());
    const onPop = () => setTabState(fromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [fromUrl]);

  const setTab = useCallback(
    (next: T) => {
      setTabState(next);
      const url = new URL(window.location.href);
      if (next === def) url.searchParams.delete(param);
      else url.searchParams.set(param, next);
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    },
    [router, param, def],
  );

  return [tab, setTab];
}

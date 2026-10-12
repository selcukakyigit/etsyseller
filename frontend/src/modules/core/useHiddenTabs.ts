"use client";

import { useCallback, useEffect, useState } from "react";

/** Kişiye özel gizlenen sekmeler (bu tarayıcıda, kayıt başına): sekme kaldırılmaz, yalnızca bu kişinin ekranında görünmez. */
export function useHiddenTabs(key: string): [string[], (id: string, hidden: boolean) => void] {
  const storageKey = `ulagg:hidden-tabs:${key}`;
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
      // Saklanan değer ancak tarayıcıda okunabilir; bağlandıktan sonra bir kez eşitlemek kaçınılmaz.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHidden(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
    } catch {
      setHidden([]);
    }
  }, [storageKey]);
  const toggle = useCallback(
    (id: string, hide: boolean) =>
      setHidden((current) => {
        const next = hide ? [...new Set([...current, id])] : current.filter((x) => x !== id);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* depolama kapalıysa seçim yalnızca bu oturumda geçerli */
        }
        return next;
      }),
    [storageKey],
  );
  return [hidden, toggle];
}

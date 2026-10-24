"use client";

import { useCallback, useMemo } from "react";
import { useStoredState } from "@/lib/useStoredState";

const MAX_RECENT = 8;

function parse(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Mağaza başına son aramalar (bu tarayıcıda; sunucuya gitmez). Yeni arama başa gelir, tekrar eden tek kalır. */
export function useRecentSearches(shopId: number): { recent: string[]; remember: (query: string) => void; clear: () => void } {
  const [raw, setRaw] = useStoredState<string>(`discover-recent:${shopId}`, "[]");
  const recent = useMemo(() => parse(raw), [raw]);
  const remember = useCallback(
    (query: string) => {
      const q = query.trim();
      if (q) setRaw(JSON.stringify([q, ...parse(raw).filter((x) => x !== q)].slice(0, MAX_RECENT)));
    },
    [raw, setRaw],
  );
  const clear = useCallback(() => setRaw("[]"), [setRaw]);
  return { recent, remember, clear };
}

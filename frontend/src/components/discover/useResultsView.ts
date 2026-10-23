"use client";

import { useCallback, useMemo, useState } from "react";
import type { DiscoverItem } from "@/lib/discoverApi";
import { EMPTY_FILTERS, Filters, Sort, SortKey, applyFilters, sortItems, wordGroups } from "./table";

/** Bir kelime listesinin görünümü: süzgeçler, sıralama, seçim ve kelime grupları. Araştırma sonucu ve kaydedilenler aynı mantığı kullanır. */
export function useResultsView(items: DiscoverItem[], seed: string, etsy: Record<string, number | null>) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<Sort>({ key: "volume", dir: "desc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const view = useMemo(() => sortItems(applyFilters(items, filters), sort, etsy), [items, filters, sort, etsy]);
  const groups = useMemo(() => wordGroups(items, seed), [items, seed]);
  const volume = useMemo(() => view.reduce((sum, i) => sum + (i.volume ?? 0), 0), [view]);

  const onSort = useCallback((key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "term" ? "asc" : "desc" })), []);
  const toggle = useCallback((term: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  }, []);
  const toggleMany = useCallback((terms: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of terms) {
        if (checked) next.add(t);
        else next.delete(t);
      }
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  return { filters, setFilters, sort, onSort, selected, toggle, toggleMany, clearSelection, view, groups, volume };
}

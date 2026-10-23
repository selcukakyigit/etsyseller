import type { DiscoverItem, Intent } from "@/lib/discoverApi";

/** Keşfet tablosunun saf mantığı (süzme, sıralama, kelime grupları, CSV): bileşenlerden ayrı, kolay denenir. */

export type SortKey = "term" | "volume" | "trend" | "cpc" | "competition" | "etsy";
export type Sort = { key: SortKey; dir: "asc" | "desc" };

export type Filters = {
  include: string; // boşlukla ayrılmış kelimelerin HEPSİ bulunmalı
  exclude: string; // bunlardan HİÇBİRİ bulunmamalı
  minVolume: string;
  maxVolume: string;
  intent: Intent | "";
  questionsOnly: boolean;
  hideMine: boolean;
  words: string[]; // kelime grubu süzgeçleri (hepsi bulunmalı)
};

export const EMPTY_FILTERS: Filters = { include: "", exclude: "", minVolume: "", maxVolume: "", intent: "", questionsOnly: false, hideMine: false, words: [] };

const QUESTION_WORDS = new Set(["how", "what", "why", "when", "where", "which", "who", "whom", "whose", "can", "could", "does", "do", "did", "is", "are", "was", "will", "should", "would"]);
const STOP_WORDS = new Set(["a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "with", "at", "by", "from", "is", "it", "my", "your", "near", "me", "vs", "how", "what", "do", "i"]);

const words = (term: string) => term.toLowerCase().split(/\s+/).filter(Boolean);

export const isQuestion = (term: string) => QUESTION_WORDS.has(words(term)[0] ?? "");

export function filtersActive(f: Filters): boolean {
  return JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);
}

export function applyFilters(items: DiscoverItem[], f: Filters): DiscoverItem[] {
  const inc = words(f.include);
  const exc = words(f.exclude);
  const min = f.minVolume === "" ? null : Number(f.minVolume);
  const max = f.maxVolume === "" ? null : Number(f.maxVolume);
  return items.filter((i) => {
    const w = words(i.term);
    if (inc.length && !inc.every((x) => w.some((t) => t.includes(x)))) return false;
    if (exc.length && exc.some((x) => w.some((t) => t.includes(x)))) return false;
    if (f.words.length && !f.words.every((x) => w.includes(x))) return false;
    if (min !== null && (i.volume ?? 0) < min) return false;
    if (max !== null && (i.volume ?? 0) > max) return false;
    if (f.intent && i.intent !== f.intent) return false;
    if (f.questionsOnly && !isQuestion(i.term)) return false;
    if (f.hideMine && i.mine) return false;
    return true;
  });
}

const sortValue = (i: DiscoverItem, key: SortKey, etsy: Record<string, number | null>): number | string | null => {
  switch (key) {
    case "term":
      return i.term;
    case "volume":
      return i.volume;
    case "trend":
      return i.trend_pct;
    case "cpc":
      return i.cpc;
    case "competition":
      return i.competition;
    case "etsy":
      return etsy[i.term] ?? null;
  }
};

/** Boş değerler (ölçülmemiş) yönden bağımsız hep sona gider. */
export function sortItems(items: DiscoverItem[], sort: Sort, etsy: Record<string, number | null>): DiscoverItem[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const x = sortValue(a, sort.key, etsy);
    const y = sortValue(b, sort.key, etsy);
    if (x === null && y === null) return a.term.localeCompare(b.term);
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === "string" && typeof y === "string") return sign * x.localeCompare(y);
    return sign * ((x as number) - (y as number)) || a.term.localeCompare(b.term);
  });
}

/** Listedeki en sık geçen anlamlı kelimeler (Semrush'taki "large 637" grupları gibi): [{ word, count }]. */
export function wordGroups(items: DiscoverItem[], seed: string, limit = 14): { word: string; count: number }[] {
  const skip = new Set(words(seed));
  const counts = new Map<string, number>();
  for (const i of items) {
    for (const w of new Set(words(i.term))) {
      if (w.length < 3 || STOP_WORDS.has(w) || skip.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

/** Aylık arama ÷ Etsy ilan sayısı: yüksekse az rekabetle çok arama (fırsat). Ölçülmediyse ya da ilan yoksa null. */
export function opportunity(volume: number | null, etsyCount: number | null | undefined): number | null {
  return volume && etsyCount ? volume / etsyCount : null;
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(items: DiscoverItem[], etsy: Record<string, number | null>): string {
  const head = ["keyword", "google_monthly_searches", "cpc_usd", "ad_competition_0_100", "trend_pct", "intent", "etsy_listings"];
  const rows = items.map((i) => [i.term, i.volume, i.cpc, i.competition, i.trend_pct, i.intent, etsy[i.term] ?? null]);
  return [head, ...rows].map((r) => r.map((c) => csvCell(c as string | number | null)).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

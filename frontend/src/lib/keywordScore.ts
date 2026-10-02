import { KeywordPoolItem } from "@/lib/api";

/** Green = favorable, red = unfavorable — same convention every SEO tool uses for a difficulty/competition
 * score. Ama skorumuz kaynağa göre ters anlama geliyor: rakip etiketinde yüksek skor "çoğu üst sıradaki
 * rakip zaten bunu kullanıyor" demek (doymuş → kırmızı); kendi etiketinde yüksek skor "kendi en çok satan
 * listing'lerin kullandığı, kanıtlanmış" demek (iyi → yeşil). Yön kaynağa göre ters çevriliyor. */
export function competitionFill(normalized: number, source: KeywordPoolItem["source"]): string {
  // Rakipte yüksek kullanım = kalabalık (kötü); kendi satışın ve Etsy verisinde yüksek değer = iyi.
  const favorable = source === "competitor" ? 1 - normalized : normalized;
  const hue = favorable * 130; // 0 = kırmızı, 130 = yeşil
  return `hsla(${hue}, 70%, 45%, 0.3)`;
}

/** Havuzdaki her kaynak (own/competitor) için min/max — normalize etmek için. Ham skor/örnek oranı yerine
 * havuz İÇİNDE birbirine göre kıyaslamak, etiketleri tüm yeşil-kırmızı aralığına yayıyor. */
export function poolRanges(items: KeywordPoolItem[]): Map<string, { min: number; max: number }> {
  const bySource = new Map<string, { min: number; max: number }>();
  for (const item of items) {
    const value = item.source === "own" ? (item.units ?? 0) : item.score;
    const range = bySource.get(item.source) ?? { min: Infinity, max: -Infinity };
    range.min = Math.min(range.min, value);
    range.max = Math.max(range.max, value);
    bySource.set(item.source, range);
  }
  return bySource;
}

export function normalizedScore(item: KeywordPoolItem, ranges: Map<string, { min: number; max: number }>): number {
  const range = ranges.get(item.source);
  if (!range) return item.source === "competitor" ? 1 : 0.5;
  const value = item.source === "own" ? (item.units ?? 0) : item.score;
  return range.max > range.min ? (value - range.min) / (range.max - range.min) : item.source === "competitor" ? 1 : 0.5;
}

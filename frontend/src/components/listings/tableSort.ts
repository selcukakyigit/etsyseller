// Listing analiz tablosunun saf mantığı: sütun anahtarları, sıralama, dönüşüm oranı. Bileşen içermez (tests/ui/listing-table.test.mjs doğrudan çalıştırır).
import type { CardSale, Listing, TrackedRank } from "../../lib/api";

export type TableKey = "title" | "price" | "stock" | "sales_month" | "sales_total" | "views" | "favorites" | "conversion" | "rank" | "updated";
export type TableSort = { key: TableKey; dir: "asc" | "desc" };

export const DEFAULT_TABLE_SORT: TableSort = { key: "sales_total", dir: "desc" };
export const TABLE_KEYS: TableKey[] = ["title", "price", "stock", "sales_month", "sales_total", "views", "favorites", "conversion", "rank", "updated"];

/** Bir sütuna ilk tıklamada hangi yönle sıralanır: metin ve sıra (küçük = iyi) artan, sayılar azalan. */
export function firstDirection(key: TableKey): "asc" | "desc" {
  return key === "title" || key === "rank" || key === "price" ? "asc" : "desc";
}

/** Başlığa tıklama: aynı sütun yön değiştirir, farklı sütun kendi ilk yönüyle başlar. */
export function nextSort(current: TableSort, key: TableKey): TableSort {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDirection(key) };
}

/** Satış ÷ görüntülenme, yüzde (tüm zamanlar). Görüntülenme ya da satış verisi yoksa null. Sipariş geçmişi listing'in ömründen kısaysa düşük çıkabilir. */
export function conversionPct(views: number | null | undefined, sale?: CardSale): number | null {
  if (!sale || !views || views <= 0) return null;
  return (sale.total / views) * 100;
}

export type TableData = {
  sales?: Record<string, CardSale>;
  ranks?: Record<string, TrackedRank>;
  touchedAt: (l: Listing) => number;
};

/** Sütunun sayısal değeri; veri yoksa null (null her zaman sonda kalır, yön ne olursa olsun). */
export function cellValue(l: Listing, key: TableKey, data: TableData): number | string | null {
  const sale = data.sales?.[String(l.listing_id)];
  switch (key) {
    case "title":
      return l.title.toLowerCase();
    case "price":
      return l.price_min ?? null;
    case "stock":
      return l.quantity ?? null;
    case "sales_month":
      return sale ? sale.this_month : null;
    case "sales_total":
      return sale ? sale.total : null;
    case "views":
      return l.views ?? null;
    case "favorites":
      return l.favorites ?? null;
    case "conversion":
      return conversionPct(l.views, sale);
    case "rank": {
      const r = data.ranks?.[String(l.listing_id)];
      return r && r.position ? r.position : null; // takipte ama ilk N içinde değilse (position yok) sırasız sayılır
    }
    case "updated":
      return data.touchedAt(l) || null;
  }
}

export function compareListings(sort: TableSort, data: TableData): (a: Listing, b: Listing) => number {
  const sign = sort.dir === "asc" ? 1 : -1;
  return (a, b) => {
    const x = cellValue(a, sort.key, data);
    const y = cellValue(b, sort.key, data);
    if (x === null && y === null) return a.title.localeCompare(b.title);
    if (x === null) return 1; // verisiz satırlar her zaman en altta
    if (y === null) return -1;
    const c = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y;
    if (c !== 0) return c * sign;
    // eşitlikte kararlı ve anlamlı ikinci ölçüt: toplam satış çoksa önce, sonra başlık
    const sa = data.sales?.[String(a.listing_id)]?.total ?? 0;
    const sb = data.sales?.[String(b.listing_id)]?.total ?? 0;
    return sb - sa || a.title.localeCompare(b.title);
  };
}

/** useStoredState yalnızca metin tutar: sıralama "anahtar:yön" olarak saklanır. */
export const TABLE_SORT_VALUES: readonly string[] = TABLE_KEYS.flatMap((k) => [`${k}:asc`, `${k}:desc`]);
export const encodeSort = (s: TableSort): string => `${s.key}:${s.dir}`;
export function decodeSort(raw: string): TableSort {
  const [key, dir] = raw.split(":");
  return TABLE_KEYS.includes(key as TableKey) && (dir === "asc" || dir === "desc") ? { key: key as TableKey, dir } : DEFAULT_TABLE_SORT;
}

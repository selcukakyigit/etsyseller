import { apiRequest } from "@/lib/api";

/** Keşfet (kelime araştırması) API istemcisi (bkz. backend research/discover.py). Aylık arama, CPC ve rekabet GOOGLE verisidir; Etsy arama hacmi DEĞİLDİR. */

export type Demand = "low" | "medium" | "high";
export type Intent = "informational" | "navigational" | "commercial" | "transactional";

export type DiscoverItem = {
  term: string;
  /** Kaba talep bandı (editördeki "G:" rozeti ile aynı); ölçüm hazır değilse null */
  demand: Demand | null;
  /** Google aylık arama */
  volume: number | null;
  /** USD */
  cpc: number | null;
  /** 0–100 Google Ads reklam rekabeti (Etsy organik rekabeti değil) */
  competition: number | null;
  /** Son 12 ay (eskiden yeniye); veri yoksa boş */
  monthly: number[];
  /** Son 3 ay ortalaması ilk 3 aya göre % değişim */
  trend_pct: number | null;
  intent: Intent | null;
  /** Son günlerde birçok mağazaya önerilmiş */
  crowded: boolean;
  /** Mağazanın listing'lerinde zaten etiket olarak var */
  mine: boolean;
  saved: boolean;
};

export type SearchStatus = "ready" | "pending" | "refused" | "empty" | "invalid";

export type DiscoverSearch = {
  seed: string;
  status: SearchStatus;
  /** budget | shop_daily | shop_searches | disabled | not_configured | market */
  refused: string | null;
  seed_item: DiscoverItem | null;
  items: DiscoverItem[];
  stale: boolean;
  total_volume: number;
};

export type SavedCollection = { name: string; count: number };

export type DiscoverSaved = { collections: SavedCollection[]; collection: string; total: number; items: DiscoverItem[] };

const base = (shopId: number) => `/api/shops/${shopId}/discover`;

export const discoverApi = {
  search: (shopId: number, q: string) => apiRequest<DiscoverSearch>(`${base(shopId)}/search?q=${encodeURIComponent(q)}`),
  saved: (shopId: number, collection?: string) =>
    apiRequest<DiscoverSaved>(`${base(shopId)}/saved${collection === undefined ? "" : `?collection=${encodeURIComponent(collection)}`}`),
  save: (shopId: number, terms: string[], collection: string) =>
    apiRequest<{ added: number }>(`${base(shopId)}/saved`, { method: "POST", body: JSON.stringify({ terms, collection }) }),
  unsave: (shopId: number, terms: string[], collection: string) =>
    apiRequest<{ removed: number }>(`${base(shopId)}/saved/remove`, { method: "POST", body: JSON.stringify({ terms, collection }) }),
  /** Kelimelerin Etsy'deki aktif ilan sayısı (rakip sayısı); en fazla 20 kelime. `limited`: ölçüm hakkı geçici doldu. */
  etsyResults: (shopId: number, terms: string[]) =>
    apiRequest<{ counts: Record<string, number | null>; limited: boolean }>(`${base(shopId)}/etsy-results`, { method: "POST", body: JSON.stringify({ terms }) }),
};

export const ETSY_RESULTS_MAX = 20;

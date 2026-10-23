import { apiRequest } from "@/lib/api";

/** Keşfet (kelime araştırması) API istemcisi. Yanıtlarda ham arama sayısı yoktur, yalnızca bant (bkz. backend research/discover.py). */

export type Demand = "low" | "medium" | "high";
export type Intent = "informational" | "navigational" | "commercial" | "transactional";

export type DiscoverItem = {
  term: string;
  /** Google'da talep bandı; ölçüm henüz hazır değilse null. Etsy arama hacmi DEĞİLDİR. */
  demand: Demand | null;
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
};

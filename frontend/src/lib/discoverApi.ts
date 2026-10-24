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
  /** Serinin son ayı "YYYY-AA"; ay adları buradan geriye sayılır */
  last_month: string | null;
  /** Son 3 ay ortalaması ilk 3 aya göre % değişim */
  trend_pct: number | null;
  intent: Intent | null;
  /** Son günlerde birçok mağazaya önerilmiş */
  crowded: boolean;
  /** Mağazanın listing'lerinde zaten etiket olarak var */
  mine: boolean;
  saved: boolean;
};

/** Boş Keşfet ekranı: mağazanın en sık etiketleri, yaklaşan sezon, koleksiyonlar (backend discover.home). */
export type DiscoverHomeData = {
  tags: DiscoverItem[];
  /** Önümüzdeki 3 ayda zirve yapacak etiketler; in_months 0 = şimdi zirvede */
  upcoming: (DiscoverItem & { in_months: number; peak_months: number[] })[];
  collections: SavedCollection[];
  /** Bazı etiketlerin mevsimselliği hesaplanıyor: ekran biraz sonra yeniden sorar */
  preparing: boolean;
};

export type SearchStatus = "ready" | "pending" | "refused" | "empty" | "invalid";

/** Takvim ayına göre göreli ilgi (Google Trends, 5 yıl ortalaması); monthly[0]=Ocak, en yüksek ay 100. Profil yoksa monthly boş. */
export type Season = {
  monthly: number[];
  peak_months: number[];
  seasonal: boolean;
  pending: boolean;
  /** Ölçülmüş aylık arama `min_volume` altında: mevsimsellik istenmedi (ücret yok) */
  too_rare: boolean;
  min_volume: number;
};

export type DiscoverSearch = {
  seed: string;
  status: SearchStatus;
  /** budget | shop_daily | shop_searches | disabled | not_configured | market */
  refused: string | null;
  seed_item: DiscoverItem | null;
  items: DiscoverItem[];
  stale: boolean;
  total_volume: number;
  mode: "all" | "questions";
  /** Listedeki ölçümlerin en yenisi (ISO); verinin ne zaman alındığı */
  measured_at: string | null;
  /** Yalnızca "all" görünümünde, tohum kelime için */
  season: Season | null;
};

export type SearchMode = "all" | "questions";

/** Etsy'deki ilk 20 sonucun analizi (Etsy verisi; backend research/etsy_top.py). */
export type EtsyAnalysis = {
  term: string;
  total: number;
  sample: number;
  currency: string | null;
  price: { p25: number | null; median: number | null; p75: number | null };
  /** 10+ favorisi olan ilan sayısı (ilk 20 içinde) */
  proven: number;
  strong: number;
  favorites: { p75: number | null; max: number | null };
  views: { median: number | null };
  age_days_median: number | null;
  new_share: number | null;
  top_tags: { tag: string; count: number }[];
  listings: { listing_id: number | null; title: string; url: string; image: string | null; price: number | null; currency: string | null; favorites: number; views: number; age_days: number; shop_id: number | null; personalizable: boolean }[];
};

export type SavedCollection = { name: string; count: number };

export type DiscoverSaved = { collections: SavedCollection[]; collection: string; total: number; items: DiscoverItem[] };

const base = (shopId: number) => `/api/shops/${shopId}/discover`;

export const discoverApi = {
  search: (shopId: number, q: string, mode: SearchMode = "all", refresh = false) =>
    apiRequest<DiscoverSearch>(`${base(shopId)}/search?q=${encodeURIComponent(q)}&mode=${mode}${refresh ? "&refresh=true" : ""}`),
  saved: (shopId: number, collection?: string) =>
    apiRequest<DiscoverSaved>(`${base(shopId)}/saved${collection === undefined ? "" : `?collection=${encodeURIComponent(collection)}`}`),
  save: (shopId: number, terms: string[], collection: string) =>
    apiRequest<{ added: number }>(`${base(shopId)}/saved`, { method: "POST", body: JSON.stringify({ terms, collection }) }),
  unsave: (shopId: number, terms: string[], collection: string) =>
    apiRequest<{ removed: number }>(`${base(shopId)}/saved/remove`, { method: "POST", body: JSON.stringify({ terms, collection }) }),
  home: (shopId: number) => apiRequest<DiscoverHomeData>(`${base(shopId)}/home`),
  /** Tek kelimenin mevsimsellik profili; `pending` iken yoklanır. Geçersiz kelimede season null. */
  season: (shopId: number, q: string) => apiRequest<{ season: Season | null }>(`${base(shopId)}/season?q=${encodeURIComponent(q)}`),
  /** Bir aramanın Etsy'deki ilk 20 sonucunun analizi; `limited`: ölçüm hakkı geçici doldu. */
  etsyTop: (shopId: number, term: string) => apiRequest<{ analysis: EtsyAnalysis | null; limited: boolean }>(`${base(shopId)}/etsy-top`, { method: "POST", body: JSON.stringify({ term }) }),
  /** Kelimelerin Etsy'deki aktif ilan sayısı (rakip sayısı); en fazla 20 kelime. `limited`: ölçüm hakkı geçici doldu. */
  etsyResults: (shopId: number, terms: string[]) =>
    apiRequest<{ counts: Record<string, number | null>; limited: boolean }>(`${base(shopId)}/etsy-results`, { method: "POST", body: JSON.stringify({ terms }) }),
};

export const ETSY_RESULTS_MAX = 20;

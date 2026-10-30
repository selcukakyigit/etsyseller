import { apiBlob, apiRequest } from "@/lib/api";
import { tNow } from "@/lib/i18n";
import { type KeywordFilters, filterBody, filterQuery } from "@/lib/researchFilters";

export { type KeywordFilters, EMPTY_KEYWORD_FILTERS, advancedFilterCount } from "@/lib/researchFilters";

/** Yönetim > Araştırma (ortak keyword havuzu) API istemcisi. Uç noktalar yalnızca yöneticiye açıktır (backend/app/research/admin_router.py). */

/** Yönetim uyarısı; metni arayüz üretir (components/admin/research/AlertsStrip.tsx). `value`/`limit` anlamı anahtara göre: yüzde, dakika, sayı ya da tutar. */
export type ResearchAlert = { key: string; level: "warn" | "bad"; value: number | null; limit: number | null };

export type ResearchOverview = {
  terms: number;
  metrics: number;
  fresh_terms: number;
  new_terms_24h: number;
  jobs: Record<string, number>;
  calls_24h: number;
  errors_24h: number;
  spend_month: number;
  budget_month: number;
  credentials: "none" | "database" | "env";
  enabled: boolean;
  alerts: ResearchAlert[];
};

export type KeywordState = "fresh" | "stale" | "missing";
export type KeywordStatus = "active" | "archived" | "blocked";

export type ResearchKeyword = {
  id: number;
  term: string;
  language: string;
  first_source: string;
  created_at: string;
  last_used_at: string | null;
  /** active | archived (otomatik yenilenmez) | blocked (hiç ölçülmez, Keşfet'te görünmez) */
  status: KeywordStatus;
  pinned: boolean;
  market: string | null;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  measured_at: string | null;
  expires_at: string | null;
  state: KeywordState;
  /** Yalnızca state === "missing": ölçümün neden olmadığı. */
  reason: "" | "queued" | "failed" | "other_market" | "none";
  reason_detail: string;
  etsy_shops: number;
};

export type KeywordSort = "new" | "volume" | "cpc" | "difficulty" | "measured" | "expires" | "used";

/** Mağazaların Marketplace Insights'tan yapıştırdığı verinin özeti (yalnızca toplu sayılar; Google ölçümünden ayrı). */
export type ResearchEtsyInsights = {
  shops: number;
  searches_min: number | null;
  searches_median: number | null;
  searches_max: number | null;
  results_median: number | null;
  trend_median: number | null;
  conversion: "very_low" | "low" | "medium" | "high" | "very_high" | null;
  latest_on: string | null;
};

export type ResearchPage<T> = { items: T[]; total: number; page: number; per_page: number; capped?: boolean };

export type BulkAction = "refresh" | "pin" | "unpin" | "block" | "unblock" | "archive" | "unarchive" | "delete";
export type BulkResult = { matched: number; changed: number; skipped: number; pending: number; requests: number; refused: string | null };

export type PoolHealth = {
  market: string;
  language: string;
  terms: number;
  fresh: number;
  expiring_7d: number;
  stale: number;
  missing: number;
  status: Record<KeywordStatus, number>;
  pinned: number;
  unused_90d: number;
  metric_rows: number;
  sources: { key: string; count: number }[];
  markets: { key: string; count: number }[];
  forecast: { due: number; requests: number; estimated_usd: number | null };
};

export type UsageDay = {
  day: string;
  search_hit: number;
  search_stale: number;
  search_miss: number;
  volume_fresh: number;
  volume_stale: number;
  volume_miss: number;
  refused: number;
};

export type UsageAnalytics = {
  days: UsageDay[];
  hit_rate: number | null;
  refused: { key: string; count: number }[];
  latency: { kind: string; jobs: number; p50_s: number | null; p95_s: number | null }[];
  top_searches: { term: string; market: string; searches: number; empty: number }[];
  empty_searches: { term: string; market: string; searches: number; empty: number }[];
  shops: { shop_id: number; jobs: number; cost_usd: number }[];
};

export type ResearchMetric = {
  source: string;
  market: string;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  monthly: number[][] | null;
  measured_at: string;
  expires_at: string;
};

export type ResearchSignals = {
  suggested_shops: number;
  applied: number;
  measured: number;
  better: number;
  worse: number;
  same: number;
  unclear: number;
  low_data: number;
};

export type ResearchKeywordDetail = {
  keyword: ResearchKeyword;
  etsy: ResearchEtsyInsights | null;
  signals: ResearchSignals;
  history: ResearchMetric[];
  related: { term: string; search_volume: number | null; relation: string }[];
  seeds: string[];
};

export type ResearchJob = {
  id: number;
  kind: string;
  market: string;
  language: string;
  status: "queued" | "running" | "done" | "failed" | "dead" | "cancelled";
  attempts: number;
  shop_id: number | null;
  cost_usd: number;
  error: string;
  items: number;
  created_at: string;
  finished_at: string | null;
  run_after: string;
};

export type ResearchCall = {
  id: number;
  endpoint: string;
  market: string;
  items: number;
  cost_usd: number;
  duration_ms: number;
  ok: boolean;
  error: string;
  created_at: string;
};

export type ResearchCost = {
  days: { day: string; cost_usd: number; calls: number; errors: number }[];
  by_endpoint: { endpoint: string; cost_usd: number; calls: number; errors: number }[];
  month_spend: number;
  month_budget: number;
  projected_month: number;
};

export type ResearchSettings = {
  research_enabled: boolean;
  research_default_market: string;
  research_default_language: string;
  research_ttl_volume_days: number;
  research_ttl_volume_high_days: number;
  research_ttl_volume_low_days: number;
  research_tier_high_volume: number;
  research_tier_low_volume: number;
  research_ttl_suggest_days: number;
  research_ttl_jitter: number;
  research_monthly_budget_usd: number;
  research_budget_volume_usd: number;
  research_budget_suggest_usd: number;
  research_budget_season_usd: number;
  research_budget_trend_usd: number;
  research_low_balance_usd: number;
  research_shop_daily_jobs: number;
  research_shop_monthly_searches: number;
  research_shop_daily_searches: number;
  research_refresh_per_day: number;
  research_active_days: number;
};

export type ResearchAccount = { ok: boolean; error?: string; balance?: number | null; total?: number | null; login?: string | null };

const BASE = "/api/admin/research";
const post = <T>(path: string, body?: unknown) => apiRequest<T>(`${BASE}${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const researchAdmin = {
  overview: () => apiRequest<ResearchOverview>(`${BASE}/overview`),
  keywords: (f: KeywordFilters, p: { sort: KeywordSort; page: number }) =>
    apiRequest<ResearchPage<ResearchKeyword>>(`${BASE}/keywords?${filterQuery(f, { sort: p.sort, page: String(p.page) })}`),
  /** Süzgece uyan kelimeleri (en çok 10 000) CSV olarak indirir. */
  exportCsv: (f: KeywordFilters) =>
    apiBlob(`${BASE}/keywords/export?${filterQuery(f)}`, tNow("Dışa aktarılamadı", "Could not export")),
  /** Seçili kelimelere ya da süzgece uyanların hepsine (en çok 1000) toplu işlem. */
  bulk: (action: BulkAction, target: { ids: number[] } | { filters: KeywordFilters }) =>
    post<BulkResult>("/keywords/bulk", { action, ...("ids" in target ? { ids: target.ids } : { filters: filterBody(target.filters) }) }),
  health: () => apiRequest<PoolHealth>(`${BASE}/health`),
  analytics: () => apiRequest<UsageAnalytics>(`${BASE}/analytics`),
  keyword: (id: number) => apiRequest<ResearchKeywordDetail>(`${BASE}/keywords/${id}`),
  refresh: (terms: string[], pin = false) => post<{ pending: number; refused: string | null }>("/keywords/refresh", { terms, pin }),
  jobs: (p: { status: string; page: number }) => apiRequest<ResearchPage<ResearchJob>>(`${BASE}/jobs?status=${p.status}&page=${p.page}`),
  retryJob: (id: number) => post<{ ok: boolean }>(`/jobs/${id}/retry`),
  cancelJob: (id: number) => post<{ ok: boolean }>(`/jobs/${id}/cancel`),
  calls: () => apiRequest<ResearchCall[]>(`${BASE}/calls`),
  cost: () => apiRequest<ResearchCost>(`${BASE}/cost`),
  settings: () => apiRequest<ResearchSettings>(`${BASE}/settings`),
  settingDefaults: () => apiRequest<ResearchSettings>(`${BASE}/settings/defaults`),
  saveSettings: (values: Partial<ResearchSettings>) =>
    apiRequest<ResearchSettings>(`${BASE}/settings`, { method: "PUT", body: JSON.stringify({ values }) }),
  saveCredentials: (login: string, password: string) =>
    apiRequest<{ credentials: string }>(`${BASE}/credentials`, { method: "PUT", body: JSON.stringify({ login, password }) }),
  clearCredentials: () => apiRequest<{ credentials: string }>(`${BASE}/credentials`, { method: "DELETE" }),
  account: () => apiRequest<ResearchAccount>(`${BASE}/account`),
};

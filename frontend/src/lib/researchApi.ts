import { apiRequest } from "@/lib/api";

/** Yönetim > Araştırma (ortak keyword havuzu) API istemcisi. Uç noktalar yalnızca yöneticiye açıktır (backend/app/research/admin_router.py). */

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
};

export type KeywordState = "fresh" | "stale" | "missing";

export type ResearchKeyword = {
  id: number;
  term: string;
  language: string;
  first_source: string;
  created_at: string;
  last_used_at: string | null;
  market: string | null;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  measured_at: string | null;
  state: KeywordState;
  etsy_shops: number;
};

export type KeywordSort = "new" | "volume" | "cpc" | "difficulty" | "measured";

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

export type ResearchPage<T> = { items: T[]; total: number; page: number; per_page: number };

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
  research_ttl_suggest_days: number;
  research_ttl_jitter: number;
  research_monthly_budget_usd: number;
  research_shop_daily_jobs: number;
  research_shop_daily_searches: number;
  research_refresh_per_day: number;
  research_active_days: number;
};

export type ResearchAccount = { ok: boolean; error?: string; balance?: number | null; total?: number | null; login?: string | null };

const BASE = "/api/admin/research";
const post = <T>(path: string, body?: unknown) => apiRequest<T>(`${BASE}${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const researchAdmin = {
  overview: () => apiRequest<ResearchOverview>(`${BASE}/overview`),
  keywords: (p: { q: string; state: string; page: number; sort: KeywordSort; source: string; etsy: boolean }) => {
    const params = new URLSearchParams({ q: p.q, state: p.state, page: String(p.page), sort: p.sort, source: p.source, etsy: String(p.etsy) });
    return apiRequest<ResearchPage<ResearchKeyword>>(`${BASE}/keywords?${params}`);
  },
  keyword: (id: number) => apiRequest<ResearchKeywordDetail>(`${BASE}/keywords/${id}`),
  refresh: (terms: string[]) => post<{ pending: number; refused: string | null }>("/keywords/refresh", { terms }),
  jobs: (p: { status: string; page: number }) => apiRequest<ResearchPage<ResearchJob>>(`${BASE}/jobs?status=${p.status}&page=${p.page}`),
  retryJob: (id: number) => post<{ ok: boolean }>(`/jobs/${id}/retry`),
  cancelJob: (id: number) => post<{ ok: boolean }>(`/jobs/${id}/cancel`),
  calls: () => apiRequest<ResearchCall[]>(`${BASE}/calls`),
  cost: () => apiRequest<ResearchCost>(`${BASE}/cost`),
  settings: () => apiRequest<ResearchSettings>(`${BASE}/settings`),
  saveSettings: (values: Partial<ResearchSettings>) =>
    apiRequest<ResearchSettings>(`${BASE}/settings`, { method: "PUT", body: JSON.stringify({ values }) }),
  saveCredentials: (login: string, password: string) =>
    apiRequest<{ credentials: string }>(`${BASE}/credentials`, { method: "PUT", body: JSON.stringify({ login, password }) }),
  clearCredentials: () => apiRequest<{ credentials: string }>(`${BASE}/credentials`, { method: "DELETE" }),
  account: () => apiRequest<ResearchAccount>(`${BASE}/account`),
};

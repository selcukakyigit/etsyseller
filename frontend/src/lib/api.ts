const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type User = {
  id: number;
  email: string;
};

export type Shop = {
  id: number;
  etsy_shop_id: number;
  shop_name: string;
  connected: boolean;
};

export type Suggestion = {
  id: number;
  listing_id: number;
  original_title: string;
  original_tags: string[];
  original_description: string;
  suggested_title: string;
  suggested_tags: string[];
  suggested_description: string;
  rationale: string;
  status: "pending" | "applied" | "dismissed";
  created_at: string;
};

export type Listing = {
  listing_id: number;
  title: string;
  tags: string[];
  description: string;
  url: string | null;
  image_url: string | null;
  views: number | null;
  favorites: number | null;
  pending_suggestion: Suggestion | null;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? `İstek başarısız: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  auth: {
    me: () => request<User>("/api/auth/me"),
    register: (email: string, password: string) =>
      request<User>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
    login: (email: string, password: string) =>
      request<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  },
  shops: {
    list: () => request<Shop[]>("/api/shops"),
    connectUrl: () => `${API_URL}/api/shops/connect/start`,
  },
  listings: {
    list: (shopId: number) => request<Listing[]>(`/api/shops/${shopId}/listings`),
    suggest: (shopId: number, listingId: number) =>
      request<Suggestion>(`/api/shops/${shopId}/listings/${listingId}/suggest`, { method: "POST" }),
    apply: (shopId: number, suggestionId: number) =>
      request<Suggestion>(`/api/shops/${shopId}/listings/suggestions/${suggestionId}/apply`, { method: "POST" }),
    dismiss: (shopId: number, suggestionId: number) =>
      request<Suggestion>(`/api/shops/${shopId}/listings/suggestions/${suggestionId}/dismiss`, { method: "POST" }),
  },
};

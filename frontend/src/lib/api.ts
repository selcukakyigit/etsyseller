export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type User = {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
};

export type ApiKeys = {
  etsy_api_key: string;
  etsy_shared_secret: string;
  openai_api_key: string;
  openai_model: string;
  anthropic_api_key: string;
  anthropic_model: string;
  ai_provider: string;
};

export type ApiKeysUpdate = Partial<ApiKeys>;

export type ApiKeyTestResult = {
  ok: boolean;
  message: string;
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
  applied_at: string | null;
  // Üretildiği anda formu doldurmak için döner; kalıcı saklanmaz.
  suggested_materials?: string[];
};

export type SuggestInput = {
  title?: string;
  tags?: string[];
  description?: string;
  materials?: string[];
};

export type StatSnapshot = {
  views: number;
  favorites: number;
  captured_at: string;
};

export type ListingHistory = {
  versions: Suggestion[];
  stats: StatSnapshot[];
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
  // Yerel taslak varsa başlık/etiket/açıklama/görsel taslaktan gelir.
  has_draft?: boolean;
  draft_updated_at?: string | null;
  has_local?: boolean;
  local_updated_at?: string | null;
  // Liste kartı / filtreler için özet alanlar (preview mock'ları için opsiyonel)
  state?: string | null;
  quantity?: number | null;
  price_min?: number | null;
  price_max?: number | null;
  currency?: string | null;
  skus?: string[];
  shop_section_id?: number | null;
  shipping_profile_id?: number | null;
  return_policy_id?: number | null;
  production_partner_ids?: number[];
  has_video?: boolean;
  should_auto_renew?: boolean;
  ending_timestamp?: number | null;
  last_modified_timestamp?: number | null;
  /** Henüz Etsy'de olmayan, yalnızca yerelde var olan yeni listing (negatif geçici kimlik). */
  is_new?: boolean;
};

export type BulkTextOp = {
  mode: "prefix" | "suffix" | "find_replace" | "set";
  text?: string;
  find?: string;
  replace?: string;
};

export type BulkChanges = {
  state?: "active" | "inactive";
  title?: BulkTextOp;
  description?: BulkTextOp;
  tags?: { add?: string[]; remove?: string[] };
  price?: { mode: "percent" | "amount" | "set"; value: number; rounding?: "none" | "x.99" | "x.00" };
  shop_section_id?: number;
  shipping_profile_id?: number;
  return_policy_id?: number;
  readiness_state_id?: number;
  should_auto_renew?: boolean;
  production_partner_ids?: number[];
};

export type BulkResult = { id: number; ok: boolean; changed: boolean; error: string | null };

export type KeywordPoolItem = {
  tag: string;
  source: "own" | "competitor";
  score: number;
  sample_size: number;
  google_score?: number;
};

export type OrderVariation = { name: string; value: string; personalization: boolean };

export type OrderItem = {
  listing_id: number | null;
  title: string;
  quantity: number;
  sku?: string | null;
  price?: string | null;
  image_url?: string | null;
  variations?: OrderVariation[];
};

export type OrderAddress = {
  name: string;
  first_line: string;
  second_line: string;
  city: string;
  state: string;
  zip: string;
  country_iso: string;
  formatted: string;
};

export type OrderShipment = { carrier: string | null; tracking_code: string | null; notified_at: string | null };

export type Order = {
  receipt_id: number;
  status: string;
  buyer_name: string;
  total: string;
  is_paid: boolean;
  is_shipped: boolean;
  created_at: string;
  expected_ship_date: string | null;
  items: OrderItem[];
  tracking_codes: string[];
  channel: "etsy" | "pattern";
  address: OrderAddress;
  buyer_email: string | null;
  buyer_note: string | null;
  is_gift: boolean;
  gift_message: string | null;
  gift_sender: string | null;
  coupon: string | null;
  subtotal: string | null;
  shipping_cost: string | null;
  tax: string | null;
  shipping_method: string | null;
  shipping_upgrade: string | null;
  shipments: OrderShipment[];
  has_personalization: boolean;
  is_canceled: boolean;
};

export type OrdersPage = {
  items: Order[];
  total: number;
  counts: { toship: number; completed: number; canceled: number; all: number };
  destinations: { iso: string; count: number }[];
};

export type OrdersSyncStatus = { local: number; remote_total: number | null; backfilling: boolean };

export type OrderQuery = {
  tab: string;
  q?: string;
  ship_by?: string;
  destination?: string;
  channel?: string;
  note?: boolean;
  gift?: boolean;
  personalized?: boolean;
  upgrade?: boolean;
  sort?: string;
  page?: number;
  per_page?: number;
  today?: string;
};

export type OrderInsights = {
  needs_shipping_today: number;
  overdue: number;
  top_listing_last_7_days: string | null;
  summary: string;
};

export type ListingImage = {
  // Negatif id = henüz Etsy'ye yüklenmemiş taslak görsel (draft_file_id taşır).
  draft_file_id?: string;
  url_fullxfull?: string;
  listing_image_id: number;
  rank: number;
  url_170x135: string;
  url_570xN: string;
  alt_text: string | null;
};

// Etsy's inventory/property shapes are deep and actively evolving (third
// variation rollout) — passed through as loosely-typed objects on both the
// backend and here, rather than modeled field by field. Components that need
// specific fields (VariationTable, PropertyFields) narrow locally.
export type InventoryProduct = {
  product_id: number;
  sku: string;
  offerings: {
    offering_id: number;
    quantity: number;
    is_enabled: boolean;
    price: { amount: number; divisor: number; currency_code: string };
    readiness_state_id?: number | null;
  }[];
  property_values: {
    property_id: number;
    property_name: string;
    scale_id: number | null;
    value_ids: number[];
    values: string[];
  }[];
};

export type Inventory = {
  products: InventoryProduct[];
  price_on_property: number[];
  quantity_on_property: number[];
  sku_on_property: number[];
  readiness_state_on_property?: number[];
};

export type VariationImage = {
  property_id: number;
  value_id: number;
  image_id: number;
  value?: string;
};

export type ListingProperty = {
  property_id: number;
  property_name: string;
  scale_id: number | null;
  value_ids: number[];
  values: string[];
};

export type ListingVideo = {
  draft_file_id?: string;
  video_id: number;
  height: number;
  width: number;
  thumbnail_url: string;
  video_url: string;
  video_state: string;
};

export type ListingEdit = {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  taxonomy_id: number | null;
  who_made: string | null;
  when_made: string | null;
  is_supply: boolean;
  shipping_profile_id: number | null;
  return_policy_id: number | null;
  images: ListingImage[];
  videos: ListingVideo[];
  inventory: Inventory;
  properties: ListingProperty[];

  shop_section_id: number | null;
  featured_rank: number | null;
  should_auto_renew: boolean;

  is_taxable: boolean;
  item_weight: number | null;
  item_length: number | null;
  item_width: number | null;
  item_height: number | null;
  item_weight_unit: string | null;
  item_dimensions_unit: string | null;

  production_partner_ids: number[];

  ecgt_garan_brand: string | null;
  ecgt_garan_years: number | null;
  ecgt_garan_model: string | null;
  ecgt_garan_guarantee_details: string | null;
  ecgt_other_commercial_guarantee_details: string | null;
  ecgt_after_sales_service_info: string | null;
  ecgt_software_update_details: string | null;
  // Başlık bilgileri (state dışında salt okunur)
  state?: string | null;
  listing_type?: string | null;
  url?: string | null;
  original_creation_timestamp?: number | null;
  ending_timestamp?: number | null;
};

export type VariationLinks = { property_id: number | null; images: Record<string, number> };

// Taslak: ListingEdit + bölümlerin kendi başına tuttuğu Etsy verileri. Etsy'ye yalnızca "Yayınla" ile gider.
export type WorkingCopy = ListingEdit & {
  personalization: Personalization | null;
  variation_links: VariationLinks;
  managed_property_ids: number[];
};

export type PublishResult = {
  ok: boolean;
  steps: { name: string; ok: boolean; changed?: boolean; error?: string }[];
  error: string | null;
  edit: ListingEdit | null;
  /** Etsy'de sen kaydettikten sonra değişmiş alanlar; doluysa hiçbir şey yazılmadı. */
  conflicts?: { key: string; label: string }[];
  /** Yeni listing yayınında Etsy'deki gerçek kimlik (geçici kimlik artık geçersiz). */
  listing_id?: number;
  /** Yapılamayan ama sessizce yutulmaması gereken şeyler (ör. Etsy'den boşaltılamayan alanlar). */
  warnings?: string[];
};

export type ListingUpdate = Partial<{
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  taxonomy_id: number;
  who_made: string;
  when_made: string;
  is_supply: boolean;
  shipping_profile_id: number;
  return_policy_id: number;

  shop_section_id: number | null;
  featured_rank: number | null;
  should_auto_renew: boolean;

  is_taxable: boolean;
  item_weight: number | null;
  item_length: number | null;
  item_width: number | null;
  item_height: number | null;
  item_weight_unit: string | null;
  item_dimensions_unit: string | null;

  production_partner_ids: number[];

  ecgt_garan_brand: string | null;
  ecgt_garan_years: number | null;
  ecgt_garan_model: string | null;
  ecgt_garan_guarantee_details: string | null;
  ecgt_other_commercial_guarantee_details: string | null;
  ecgt_after_sales_service_info: string | null;
  ecgt_software_update_details: string | null;
  state?: string | null;
}>;

export type ShopSection = {
  shop_section_id: number;
  title: string;
};

export type ProductionPartner = {
  production_partner_id: number;
  partner_name: string;
  location: string;
};

export type ReadinessStateDefinition = {
  readiness_state_id: number;
  readiness_state: string;
  processing_days_display_label: string;
  min_processing_days?: number;
  max_processing_days?: number;
  active_listings_count?: number;
};

export type ProcessingProfileInput = {
  readiness_state: "ready_to_ship" | "made_to_order";
  min_processing_time: number;
  max_processing_time: number;
  processing_time_unit: "days" | "weeks";
};

export type ReturnPolicyInput = {
  accepts_returns: boolean;
  accepts_exchanges: boolean;
  return_deadline: number | null;
};

export type DestinationInput = {
  id?: number | null;
  destination_country_iso?: string | null;
  destination_region?: "eu" | "non_eu" | null;
  primary_cost: number;
  secondary_cost: number;
  min_delivery_days?: number | null;
  max_delivery_days?: number | null;
};

export type ShippingProfileInput = {
  title: string;
  origin_country_iso: string;
  origin_postal_code: string | null;
  destinations: DestinationInput[];
};

export type PersonalizationQuestionType = "text_input" | "dropdown" | "unlabeled_upload" | "labeled_upload";

export type PersonalizationQuestion = {
  question_id: number | null;
  question_text: string;
  instructions: string;
  question_type: PersonalizationQuestionType;
  required: boolean;
  max_allowed_characters: number | null;
  max_allowed_files: number | null;
  options: { label: string; option_id: number | null }[];
  add_on_price: Record<string, unknown> | null;
};

// Etsy "Custom options": en fazla 5 soru.
export type PersonalizationLibraryItem = PersonalizationQuestion & { count: number };

export type Personalization = {
  questions: PersonalizationQuestion[];
};

export type TaxonomyNode = {
  id: number;
  level: number;
  name: string;
  parent_id: number | null;
  children: TaxonomyNode[];
};

export type TaxonomyPropertyValue = {
  value_id: number;
  name: string;
  scale_id: number | null;
};

export type TaxonomyProperty = {
  property_id: number;
  name: string;
  display_name: string;
  is_required: boolean;
  supports_attributes: boolean;
  supports_variations: boolean;
  is_multivalued: boolean;
  possible_values: TaxonomyPropertyValue[];
  // Ölçü alanları (Depth/Width/Height) için birimler; Etsy'nin ham cevabından gelir.
  scales?: { scale_id: number; display_name: string }[];
};

export type ShippingProfile = {
  shipping_profile_id: number;
  title: string;
  origin_country_iso?: string;
  origin_postal_code?: string | null;
  profile_type?: string;
  active_listings_count?: number;
  shipping_profile_destinations?: {
    destination_country_iso?: string | null;
    destination_region?: string | null;
    primary_cost: { amount: number; divisor: number; currency_code: string } | null;
    secondary_cost?: { amount: number; divisor: number; currency_code: string } | null;
    min_delivery_days: number | null;
    max_delivery_days: number | null;
    shipping_profile_destination_id?: number;
    shipping_carrier_id?: number | null;
    mail_class?: string | null;
  }[];
};

export type ReturnPolicy = {
  return_policy_id: number;
  accepts_returns: boolean;
  accepts_exchanges: boolean;
  return_deadline: number | null;
  active_listings_count?: number;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function detailText(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => (d && typeof d === "object" && "msg" in d ? String(d.msg) : String(d))).join("; ");
  return undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, detailText(body.detail) ?? `İstek başarısız: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Like request(), but for multipart uploads — the browser must set its own
 * Content-Type with the form boundary, so we don't force application/json. */
async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", credentials: "include", body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? `İstek başarısız: ${res.status}`);
  }
  return res.json();
}

export interface FinKpi {
  orders: number;
  units: number;
  sales: number;
  refunds: number;
  fees: number;
  overhead: number;
  cogs: number;
  profit: number;
  margin: number;
  aov: number;
  etsy_share: number;
  ads: number;
  ads_pct: number;
  all_orders: number;
  canceled: number;
  refunded_orders: number;
  problem_pct: number;
  fee_types: Record<string, number>;
  overhead_types: Record<string, number>;
}
export interface FinSeriesPoint {
  cmp: { offset: number; sales: number; orders: number; profit: number }[];
  month: string;
  sales: number;
  fees: number;
  overhead: number;
  cogs: number;
  profit: number;
  orders: number;
  prev_sales: number;
  prev_fees: number;
  prev_orders: number;
  prev_profit: number;
}
export interface FinCountry {
  iso: string;
  orders: number;
  sales: number;
  prev_orders: number;
  prev_sales: number;
}
export interface FinCustomer {
  name: string;
  country: string;
  orders: number;
  sales: number;
  last: string;
}
export interface FinProduct {
  listing_id: number;
  title: string;
  image: string;
  units: number;
  sales: number;
  fees: number;
  refunds: number;
  cogs: number;
  profit: number;
  margin: number;
  unit_cost: number | null;
  shipping_cost: number | null;
  cost_pct: number | null;
  variants: FinVariant[];
}
export interface FinVariant {
  key: string;
  units: number;
  sales: number;
  fees: number;
  cogs: number;
  unit_cost: number | null;
  shipping_cost: number | null;
  cost_pct: number | null;
}
export interface FinOrderCost {
  receipt_id: number;
  date: string;
  buyer: string;
  country: string;
  total: number;
  items: { title: string; quantity: number; variant: string; defined: boolean }[];
  auto_cost: number;
  override: number | null;
  note: string;
}
export interface FinOrderDetail {
  receipt_id: number;
  currency: string;
  created: string;
  status: string;
  is_gift: boolean;
  gift_message: string;
  buyer: string;
  buyer_message: string;
  seller_note: string;
  address: { name: string; lines: string[]; city: string; state: string; zip: string; country_iso: string };
  expected_ship: string | null;
  shipments: { carrier: string; tracking: string }[];
  items: {
    transaction_id: number | null;
    listing_id: number | null;
    title: string;
    image: string;
    quantity: number;
    price: number;
    shipping: number;
    sku: string;
    variations: { name: string; value: string }[];
    unit_cost: number;
    cost_defined: boolean;
  }[];
  earnings: {
    buyer_paid: number;
    items_price: number;
    discount: number;
    shipping: number;
    gift_wrap: number;
    subtotal: number;
    before_tax: number;
    tax_paid: number;
    fees: { label: string; type: string; amount: number; original: number; original_currency: string }[];
    fees_total: number;
    earned: number;
    has_ledger: boolean;
    fx: number | null;
    refunds: { amount: number; reason: string; status: string }[];
    cost: number;
    cost_manual: boolean;
    auto_cost: number;
    profit: number;
  };
}
export interface FinOrdersPage {
  total: number;
  orders: FinOrderCost[];
}
export interface FinReport {
  offsets: number[];
  range: { start: string; end: string; prev_start: string; prev_end: string };
  currency: string;
  coverage: { orders_in_range: number; orders_without_fees: number; fx_median: number };
  kpi: FinKpi;
  prev_kpi: FinKpi;
  series: FinSeriesPoint[];
  countries: FinCountry[];
  customers: FinCustomer[];
  products: FinProduct[];
  available_countries: string[];
  first_year: number;
}
export interface FinSyncStatus {
  running: boolean;
  entries: number;
  last_entry: string | null;
  progress: number;
  phase: string;
  error: string | null;
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
  account: {
    updateProfile: (name: string) =>
      request<User>("/api/account/profile", { method: "PUT", body: JSON.stringify({ name }) }),
    uploadAvatar: (file: File) => {
      const form = new FormData();
      form.append("avatar", file);
      return requestForm<User>("/api/account/avatar", form);
    },
    apiKeys: () => request<ApiKeys>("/api/account/api-keys"),
    updateApiKeys: (payload: ApiKeysUpdate) =>
      request<ApiKeys>("/api/account/api-keys", { method: "PUT", body: JSON.stringify(payload) }),
    testApiKey: (provider: "etsy" | "openai" | "anthropic") =>
      request<ApiKeyTestResult>(`/api/account/api-keys/test/${provider}`, { method: "POST" }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: boolean }>("/api/account/password", {
        method: "PUT",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      }),
  },
  shops: {
    list: () => request<Shop[]>("/api/shops"),
    connectUrl: () => `${API_URL}/api/shops/connect/start`,
    shippingProfiles: (shopId: number) =>
      request<ShippingProfile[]>(`/api/shops/${shopId}/shipping-profiles`),
    returnPolicies: (shopId: number) => request<ReturnPolicy[]>(`/api/shops/${shopId}/return-policies`),
    sections: (shopId: number) => request<ShopSection[]>(`/api/shops/${shopId}/sections`),
    productionPartners: (shopId: number) =>
      request<ProductionPartner[]>(`/api/shops/${shopId}/production-partners`),
    createProcessingProfile: (shopId: number, body: ProcessingProfileInput) =>
      request<unknown>(`/api/shops/${shopId}/readiness-state-definitions`, { method: "POST", body: JSON.stringify(body) }),
    updateProcessingProfile: (shopId: number, id: number, body: ProcessingProfileInput) =>
      request<unknown>(`/api/shops/${shopId}/readiness-state-definitions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    deleteProcessingProfile: (shopId: number, id: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/readiness-state-definitions/${id}`, { method: "DELETE" }),
    createReturnPolicy: (shopId: number, body: ReturnPolicyInput) =>
      request<unknown>(`/api/shops/${shopId}/return-policies`, { method: "POST", body: JSON.stringify(body) }),
    updateReturnPolicy: (shopId: number, id: number, body: ReturnPolicyInput) =>
      request<unknown>(`/api/shops/${shopId}/return-policies/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    deleteReturnPolicy: (shopId: number, id: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/return-policies/${id}`, { method: "DELETE" }),
    createShippingProfile: (shopId: number, body: ShippingProfileInput) =>
      request<ShippingProfile>(`/api/shops/${shopId}/shipping-profiles`, { method: "POST", body: JSON.stringify(body) }),
    updateShippingProfile: (shopId: number, id: number, body: ShippingProfileInput) =>
      request<ShippingProfile>(`/api/shops/${shopId}/shipping-profiles/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    deleteShippingProfile: (shopId: number, id: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/shipping-profiles/${id}`, { method: "DELETE" }),
    readinessStateDefinitions: (shopId: number) =>
      request<ReadinessStateDefinition[]>(`/api/shops/${shopId}/readiness-state-definitions`),
  },
  listings: {
    list: (shopId: number) => request<Listing[]>(`/api/shops/${shopId}/listings`),
    // full=true: değişmemiş olanlar dahil her şeyi baştan çeker (yavaş; API kotası harcar).
    sync: (shopId: number, full = false) =>
      request<{ syncing: boolean; started: boolean }>(`/api/shops/${shopId}/listings/sync${full ? "?full=true" : ""}`, {
        method: "POST",
      }),
    syncStatus: (shopId: number) =>
      request<{ syncing: boolean; last_synced_at: string | null }>(`/api/shops/${shopId}/listings/sync-status`),
    history: (shopId: number, listingId: number) =>
      request<ListingHistory>(`/api/shops/${shopId}/listings/${listingId}/history`),
    suggest: (shopId: number, listingId: number, current?: SuggestInput) =>
      request<Suggestion>(`/api/shops/${shopId}/listings/${listingId}/suggest`, {
        method: "POST",
        body: current ? JSON.stringify(current) : undefined,
      }),
    apply: (shopId: number, suggestionId: number) =>
      request<Suggestion>(`/api/shops/${shopId}/listings/suggestions/${suggestionId}/apply`, { method: "POST" }),
    dismiss: (shopId: number, suggestionId: number) =>
      request<Suggestion>(`/api/shops/${shopId}/listings/suggestions/${suggestionId}/dismiss`, { method: "POST" }),
    getEdit: (shopId: number, listingId: number) =>
      request<ListingEdit>(`/api/shops/${shopId}/listings/${listingId}/edit`),
    keywordPool: (shopId: number, listingId: number) =>
      request<{ keywords: KeywordPoolItem[] }>(`/api/shops/${shopId}/listings/${listingId}/keyword-pool`),
    keywordTrends: (shopId: number, listingId: number) =>
      request<{ keywords: KeywordPoolItem[] }>(`/api/shops/${shopId}/listings/${listingId}/keyword-pool/trends`),
    update: (shopId: number, listingId: number, payload: ListingUpdate) =>
      request<ListingEdit>(`/api/shops/${shopId}/listings/${listingId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    updateInventory: (shopId: number, listingId: number, payload: Inventory) =>
      request<Inventory>(`/api/shops/${shopId}/listings/${listingId}/inventory`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    // Toplu değişiklikleri seçili listing'lerin yerel sürümüne işler (Etsy'ye gitmez).
    bulkStage: (shopId: number, listingIds: number[], changes: BulkChanges) =>
      request<BulkResult[]>(`/api/shops/${shopId}/listings/bulk-stage`, {
        method: "POST",
        body: JSON.stringify({ listing_ids: listingIds, changes }),
      }),
    // Yerel yeni listing: sourceId verilirse o listing'in kopyası. Etsy'ye "Yayınla" ile gider.
    newListing: (shopId: number, sourceId?: number) =>
      request<{ listing_id: number; warnings?: string[] }>(`/api/shops/${shopId}/listings/new`, {
        method: "POST",
        body: JSON.stringify({ source_listing_id: sourceId ?? null }),
      }),
    // Etsy'den KALICI siler (geri alınamaz).
    deleteListing: (shopId: number, listingId: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/listings/${listingId}`, { method: "DELETE" }),
    topCategories: (shopId: number) =>
      request<{ taxonomy_id: number; count: number }[]>(`/api/shops/${shopId}/listings/top-categories`),
    getDraft: (shopId: number, listingId: number) =>
      request<{ exists: boolean; data: WorkingCopy | null; updated_at: string | null }>(
        `/api/shops/${shopId}/listings/${listingId}/draft`
      ),
    saveDraft: (shopId: number, listingId: number, data: WorkingCopy) =>
      request<{ exists: boolean; updated_at: string }>(`/api/shops/${shopId}/listings/${listingId}/draft`, {
        method: "PUT",
        body: JSON.stringify({ data }),
      }),
    discardDraft: (shopId: number, listingId: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/listings/${listingId}/draft`, { method: "DELETE" }),
    uploadDraftFile: (shopId: number, listingId: number, file: Blob, kind: "image" | "video", filename: string) => {
      const form = new FormData();
      form.append("file", file, filename);
      form.append("kind", kind);
      return requestForm<{ file_id: string; kind: string; filename: string }>(
        `/api/shops/${shopId}/listings/${listingId}/draft/files`,
        form
      );
    },
    draftFileUrl: (shopId: number, listingId: number, fileId: string) =>
      `${API_URL}/api/shops/${shopId}/listings/${listingId}/draft/files/${fileId}`,
    imageFileUrl: (shopId: number, listingId: number, imageId: number) =>
      `${API_URL}/api/shops/${shopId}/listings/${listingId}/images/${imageId}/file`,
    getLocal: (shopId: number, listingId: number) =>
      request<{ exists: boolean; data: WorkingCopy | null; updated_at: string | null }>(
        `/api/shops/${shopId}/listings/${listingId}/local`
      ),
    // base: yerel kopyanın alındığı Etsy hâli; sunucu ilk kayıtta saklar ve yayında üç yönlü karşılaştırma yapar.
    saveLocal: (shopId: number, listingId: number, data: WorkingCopy, base?: WorkingCopy | null) =>
      request<{ exists: boolean; updated_at: string }>(`/api/shops/${shopId}/listings/${listingId}/local`, {
        method: "PUT",
        body: JSON.stringify({ data, base: base ?? null }),
      }),
    discardLocal: (shopId: number, listingId: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/listings/${listingId}/local`, { method: "DELETE" }),
    publishLocal: (shopId: number, listingId: number, force = false) =>
      request<PublishResult>(`/api/shops/${shopId}/listings/${listingId}/local/publish${force ? "?force=true" : ""}`, {
        method: "POST",
      }),
    personalizationLibrary: (shopId: number) =>
      request<PersonalizationLibraryItem[]>(`/api/shops/${shopId}/listings/personalization-library`),
    variationImages: (shopId: number, listingId: number) =>
      request<VariationImage[]>(`/api/shops/${shopId}/listings/${listingId}/variation-images`),
    updateVariationImages: (shopId: number, listingId: number, items: VariationImage[]) =>
      request<VariationImage[]>(`/api/shops/${shopId}/listings/${listingId}/variation-images`, {
        method: "POST",
        body: JSON.stringify({ variation_images: items }),
      }),
    deleteProperty: (shopId: number, listingId: number, propertyId: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/listings/${listingId}/properties/${propertyId}`, {
        method: "DELETE",
      }),
    updateProperty: (
      shopId: number,
      listingId: number,
      propertyId: number,
      payload: { value_ids: number[]; values: string[]; scale_id?: number | null }
    ) =>
      request<ListingProperty>(`/api/shops/${shopId}/listings/${listingId}/properties/${propertyId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    uploadImage: (shopId: number, listingId: number, file: File, altText?: string) => {
      const form = new FormData();
      form.append("image", file);
      if (altText) form.append("alt_text", altText);
      return requestForm<ListingImage>(`/api/shops/${shopId}/listings/${listingId}/images`, form);
    },
    reorderImages: (shopId: number, listingId: number, imageIds: number[]) =>
      request<ListingImage[]>(`/api/shops/${shopId}/listings/${listingId}/images/order`, {
        method: "PUT",
        body: JSON.stringify({ image_ids: imageIds }),
      }),
    deleteImage: (shopId: number, listingId: number, imageId: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/listings/${listingId}/images/${imageId}`, {
        method: "DELETE",
      }),
    uploadVideo: (shopId: number, listingId: number, file: File) => {
      const form = new FormData();
      form.append("video", file);
      return requestForm<ListingVideo>(`/api/shops/${shopId}/listings/${listingId}/videos`, form);
    },
    deleteVideo: (shopId: number, listingId: number, videoId: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/listings/${listingId}/videos/${videoId}`, {
        method: "DELETE",
      }),
    getPersonalization: (shopId: number, listingId: number) =>
      request<Personalization>(`/api/shops/${shopId}/listings/${listingId}/personalization`),
    updatePersonalization: (shopId: number, listingId: number, payload: Personalization) =>
      request<Personalization>(`/api/shops/${shopId}/listings/${listingId}/personalization`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
  },
  taxonomy: {
    nodes: () => request<TaxonomyNode[]>("/api/taxonomy/nodes"),
    properties: (taxonomyId: number) =>
      request<TaxonomyProperty[]>(`/api/taxonomy/nodes/${taxonomyId}/properties`),
  },
  orders: {
    list: (shopId: number, needsShipping = false) =>
      request<Order[]>(`/api/shops/${shopId}/orders?needs_shipping=${needsShipping}`),
    sync: (shopId: number) => request<OrdersSyncStatus>(`/api/shops/${shopId}/orders/sync`, { method: "POST" }),
    syncStatus: (shopId: number) => request<OrdersSyncStatus>(`/api/shops/${shopId}/orders/sync-status`),
    // Sunucu tarafında filtrelenmiş ve sayfalanmış siparişler (binlerce sipariş tarayıcıya yüklenmez).
    page: (shopId: number, query: OrderQuery) => {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== "" && v !== false) params.set(k, String(v));
      });
      return request<OrdersPage>(`/api/shops/${shopId}/orders/page?${params}`);
    },
    insights: (shopId: number) => request<OrderInsights>(`/api/shops/${shopId}/orders/insights`),
    ship: (shopId: number, receiptId: number, trackingCode?: string, carrierName?: string) =>
      request<Order>(`/api/shops/${shopId}/orders/${receiptId}/ship`, {
        method: "POST",
        body: JSON.stringify({ tracking_code: trackingCode || null, carrier_name: carrierName || null }),
      }),
  },
  finance: {
    report: (shopId: number, start: string, end: string, country = "", compare: number[] = [1]) =>
      request<FinReport>(`/api/shops/${shopId}/finance/report?start=${start}&end=${end}&compare=${compare.join(",")}${country ? `&country=${country}` : ""}`),
    exportXlsx: async (shopId: number, start: string, end: string, country = "", opts: { scope?: string; q?: string; sort?: string } = {}) => {
      const params = new URLSearchParams({ start, end, scope: opts.scope ?? "all", sort: opts.sort ?? "sales" });
      if (country) params.set("country", country);
      if (opts.q) params.set("q", opts.q);
      const res = await fetch(`${API_URL}/api/shops/${shopId}/finance/export.xlsx?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Excel oluşturulamadı");
      return res.blob();
    },
    syncStatus: (shopId: number) => request<FinSyncStatus>(`/api/shops/${shopId}/finance/sync-status`),
    sync: (shopId: number, full = false) => request<FinSyncStatus>(`/api/shops/${shopId}/finance/sync?full=${full}`, { method: "POST" }),
    setCost: (shopId: number, listingId: number, unitCost: number, shippingCost: number, costPct = 0, fixPast = false) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/finance/costs/${listingId}`, {
        method: "PUT",
        body: JSON.stringify({ unit_cost: unitCost, shipping_cost: shippingCost, cost_pct: costPct, fix_past: fixPast }),
      }),
    setVariantCost: (shopId: number, listingId: number, key: string, unitCost: number, shippingCost: number, costPct = 0, fixPast = false) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/finance/costs/${listingId}/variant`, {
        method: "PUT",
        body: JSON.stringify({ key, unit_cost: unitCost, shipping_cost: shippingCost, cost_pct: costPct, fix_past: fixPast }),
      }),
    orders: (shopId: number, start: string, end: string, q = "", page = 0) =>
      request<FinOrdersPage>(`/api/shops/${shopId}/finance/orders?start=${start}&end=${end}&q=${encodeURIComponent(q)}&page=${page}`),
    orderDetail: (shopId: number, receiptId: number) => request<FinOrderDetail>(`/api/shops/${shopId}/finance/orders/${receiptId}`),
    setOrderCost: (shopId: number, receiptId: number, cost: number | null) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/finance/orders/${receiptId}/cost`, {
        method: "PUT",
        body: JSON.stringify({ cost }),
      }),
  },
};

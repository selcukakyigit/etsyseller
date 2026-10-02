import { getAccessToken, supabase } from "@/lib/supabase";
import { toast } from "@/lib/toast";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type User = {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  /** Güncel hukuki metin sürümü kabul edilmediyse true — kullanıcı /accept-terms ekranına yönlendirilir. */
  needs_consent: boolean;
};

export type ApiKeys = {
  etsy_api_key: string;
  etsy_shared_secret: string;
  openai_api_key: string;
  openai_model: string;
  anthropic_api_key: string;
  anthropic_model: string;
  ai_provider: string;
  google_api_key: string;
  google_image_model: string;
  google_image_size: string;
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
  /** Elle sabitlenmiş rapor para birimi (ör. "USD"); boşsa finans raporu siparişlerden otomatik seçer. */
  currency: string | null;
  icon_url: string | null;
};

export type ShopProfile = {
  title?: string | null;
  announcement?: string | null;
  url?: string | null;
  icon_url_fullxfull?: string | null;
  image_url_760x100?: string | null;
  num_favorers?: number;
  listing_active_count?: number;
  is_vacation?: boolean;
  vacation_message?: string | null;
  review_count?: number;
  review_average?: number | null;
};

export type ShopReview = {
  transaction_id: number;
  listing_id: number;
  rating: number;
  review: string;
  image_url: string | null;
  created_at: string;
};

export type ShopReviewListingStat = {
  listing_id: number;
  title: string | null;
  count: number;
  average: number;
};

export type ShopReviewStats = {
  top_reviewed: ShopReviewListingStat[];
  top_rated: ShopReviewListingStat[];
  rating_distribution: Record<string, number>;
  monthly: { month: string; count: number; average: number | null }[];
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
  warnings?: string[];
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

export type ListingPerformance = {
  listing_id: number;
  title: string;
  state: string | null;
  price: number | null;
  listing_age_days: number | null;
  period: { start: string; end: string };
  previous_period: { start: string; end: string };
  sales: { units: number; revenue: number; prev_units: number; prev_revenue: number };
  views_now: { available: boolean; reason?: string; views?: number; favorites?: number; partial?: boolean; tracking_started?: string };
  views_prev: { available: boolean; reason?: string; views?: number; favorites?: number; partial?: boolean };
  lifetime: { views: number; favorites: number };
  conversion_percent: number | null;
  freshness: { tracking_days: number; etsy_last_modified_days: number | null; content_changed_on?: string; days_since_content_change?: number; unchanged_for_at_least_days?: number };
  /** İçerik değiştiği günün öncesi/sonrası günlük ortalamalar (eşit uzunlukta pencere) — "AI ile yayınladık, bir şey
   * değişti mi" sorusuna cevap. Öncesi/sonrası için yeterli veri yoksa null. */
  since_change: {
    content_changed_on: string;
    window_days: number;
    before: { views_per_day: number | null; favorites_per_day: number | null; units_per_day: number; revenue_per_day: number };
    after: { views_per_day: number | null; favorites_per_day: number | null; units_per_day: number; revenue_per_day: number };
  } | null;
};

export type ListingHistory = {
  versions: Suggestion[];
  stats: StatSnapshot[];
};

export type ListingHealth = {
  listing_id: number;
  stage: "watching" | "flagged" | "stable" | "kill_candidate" | "killed";
  bottleneck: "seo" | "appeal" | "conversion" | null;
  note: string;
  attempts: number;
  window_start: string | null;
  evaluated_at: string | null;
  killed_at: string | null;
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
  /** Yalnızca kendi etiketlerinde: bu etiketi taşıyan benzer listing'lerinin son 180 günlük toplam satışı */
  units?: number;
  from_listings?: string[];
  /** Etiket bu listing'de zaten kullanılıyor */
  in_listing?: boolean;
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

// Bir fotoğraf yuvasının sürüm geçmişindeki tek bir kayıt — orijinal Etsy fotoğrafıysa file_id null,
// listing_image_id doludur; AI ile üretilmiş bir sürümse file_id dolu, listing_image_id null'dur.
export type ImageVersion = {
  file_id: string | null;
  listing_image_id: number | null;
  url: string;
  created_at: string | null;
  // Yalnızca orijinal Etsy fotoğrafı (file_id null) için: ListingImage'a dönüştürmek için gereken alanlar.
  url_170x135?: string;
  url_570xN?: string;
  url_fullxfull?: string;
  alt_text?: string | null;
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
  style: string[];
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
  style: string[];
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
  active_listing_count?: number;
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

/**
 * Sunucuya hiç ulaşılamadığında (internet yok, sunucu yeniden başlıyor, CORS) fırlatılır. Kullanıcıya sayfanın içinde kırmızı
 * "Failed to fetch" yazısı göstermek yerine sağ altta bir bildirim (toast) çıkarırız; bu yüzden `message` bilerek BOŞTUR:
 * sayfalar hata metnini `{error && ...}` ile gösterdiğinden boş mesaj sayfada hiçbir şey çizmez.
 */
export class NetworkError extends ApiError {
  constructor() {
    super(0, "");
  }
}

const NETWORK_MESSAGE = "Sunucuya ulaşılamadı. İnternet bağlantını kontrol et ya da birkaç saniye sonra tekrar dene.";

async function send(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    toast.error(NETWORK_MESSAGE);
    throw new NetworkError();
  }
}

function detailText(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => (d && typeof d === "object" && "msg" in d ? String(d.msg) : String(d))).join("; ");
  return undefined;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(await authHeader()), ...init?.headers },
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
  const res = await send(`${API_URL}${path}`, { method: "POST", headers: await authHeader(), body: formData });
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
export interface FinOrderBrief {
  receipt_id: number;
  date: string;
  buyer: string;
  country: string;
  title: string;
  item_count: number;
  sales: number;
  cogs: number;
  profit: number;
  margin: number;
  cost_defined: boolean;
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
  is_digital: boolean;
  /** Bu üründen bu dönemde satın alan müşteri adları (arama için). */
  buyers: string[];
  /** Bu dönemdeki en az bir sipariş, güncel kayıttan FARKLI eski bir maliyet sürümü kullandı (ör. "geçmişi düzelt"
   * işaretlenmeden değiştirilmiş bir değer) — gösterilen kâr/marj güncel maliyet kutucuklarıyla uyuşmayabilir. */
  variants: FinVariant[];
}
export interface FinVariant {
  key: string;
  units: number;
  sales: number;
  fees: number;
  refunds: number;
  cogs: number;
  is_digital: boolean;
  unit_cost: number | null;
  shipping_cost: number | null;
  cost_pct: number | null;
  /** Yüklenen kargo faturalarından ortalama ağırlık (varsa) — yalnızca bilgi amaçlı, hesaplamaya girmez. */
  weight_kg: number | null;
  /** Bu varyanta eşleşen onaylanmış fatura tutarlarının toplamı; kargo kutusu boşsa otomatik kullanılır. */
  invoice_amount: number;
  invoice_count: number;
  /** Faturası olan seçeneklerde: dönemdeki siparişler ve her birinin kargo faturası (yoksa null). */
  orders: { receipt_id: number; buyer: string; date: string; tracking: string; invoice: number | null }[];
}

export interface InvoiceMatchItem {
  listing_id: number | null;
  variant_key: string;
  title: string;
  qty: number;
}

/** Bir fatura satırının eşleştiği Etsy siparişi (önce takip no, olmazsa alıcı adı + ülke + tarih). */
export interface InvoiceMatch {
  receipt_id: number;
  /** İptal edilmiş sipariş: maliyeti raporlara girmez (Finans iptal edilenleri saymaz). */
  canceled: boolean;
  buyer: string;
  country: string;
  date: string;
  score: number;
  reason: string;
  items: InvoiceMatchItem[];
}

/** `/finance/invoices/parse`'ın döndüğü, henüz kaydedilmemiş bir GÖNDERİ satırı — kullanıcı siparişi onaylayınca
 * aynısı `/confirm`'e geri gönderilir. Tutar, eşleşen siparişin ürünlerine fiyat payına göre dağıtılır. */
export interface InvoiceCandidate {
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  kind: "nakliye" | "gümrük" | "ek hizmet" | "diğer";
  description: string;
  tracking_no: string;
  ship_date: string | null;
  recipient: string;
  recipient_country: string;
  weight_kg: number | null;
  original_amount: number;
  /** Satır toplamı fatura toplamıyla uyuşmuyorsa uyarı (boş = sorun yok). */
  check_note: string;
  original_currency: string;
  amount: number;
  fx_rate: number;
  fx_source: string;
  matches: InvoiceMatch[];
  already_saved: boolean;
  source_filename: string;
}

export interface InvoiceQuery {
  q?: string;
  kind?: string;
  invStart?: string;
  invEnd?: string;
  orderStart?: string;
  orderEnd?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}
export interface InvoicePage {
  items: InvoiceShipment[];
  total: number;
  total_amount: number;
}

/** Bir gönderideki tek fatura kalemi (nakliye / gümrük / ek hizmet / diğer). */
export interface InvoiceLine {
  id: number;
  kind: string;
  description: string;
  invoice_no: string;
  invoice_date: string;
  amount: number;
  original_amount: number;
  original_currency: string;
  fx_source: string;
  source_filename: string;
  weight_kg: number | null;
}

/** Kayıtlı faturalar listesinde GÖNDERİ başına tek kayıt; içinde tüm kalemleri ve olası mükerrer/fazla kesinti uyarıları. */
export interface InvoiceShipment {
  receipt_id: number | null;
  tracking_no: string;
  buyer: string;
  order_date: string | null;
  vendor: string;
  products: { listing_id: number; variant_key: string; title: string }[];
  lines: InvoiceLine[];
  total: number;
  weight_kg: number | null;
  last_invoice_date: string;
  warnings: string[];
}
export interface FinOrderCost {
  receipt_id: number;
  date: string;
  buyer: string;
  country: string;
  total: number;
  items: { title: string; quantity: number; variant: string; defined: boolean }[];
  auto_cost: number;
  fixed_cost: number;
  /** Faturalardan gelen gerçek kargo toplamı (fatura yoksa null). */
  invoice_ship: number | null;
  original_currency: string;
  original_total: number;
  auto_defined: boolean;
  earned: number;
  sales: number;
  refunds: number;
  fees_known: boolean;
  override: number | null;
  note: string;
}
export interface FinOrderDetail {
  receipt_id: number;
  currency: string;
  original_currency: string;
  original_total: number;
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
    is_digital: boolean;
    /** Adet başına maliyet parçaları; kargo kaynağı: faturadan / elle girilen / yok. */
    cost_parts: { unit: number; pct: number; ship: number; ship_source: "fatura" | "elle" | "" };
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
    fixed_cost: number;
    shipping_lines: InvoiceLine[];
    profit: number;
  };
}
export interface FinOrdersPage {
  currency: string;
  total: number;
  orders: FinOrderCost[];
}
export interface FinReport {
  offsets: number[];
  settings: { order_fixed_cost: number };
  overhead_excluded: boolean;
  range: { start: string; end: string; prev_start: string; prev_end: string };
  currency: string;
  coverage: { orders_in_range: number; orders_without_fees: number; fx_median: number };
  kpi: FinKpi;
  prev_kpi: FinKpi;
  series: FinSeriesPoint[];
  countries: FinCountry[];
  customers: FinCustomer[];
  /** Dönemdeki en kârlı / en düşük kârlı (zarar) 10'ar sipariş. */
  top_orders: FinOrderBrief[];
  worst_orders: FinOrderBrief[];
  /** Maliyeti hiç girilmemiş olduğu için bu listelere alınmayan sipariş sayısı. */
  orders_no_cost: number;
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

export type ChatCard =
  | { type: "finance"; title: string; currency: string; kpis: { label: string; value: number; prev: number; count?: boolean; invert?: boolean; highlight?: boolean }[]; countries: { iso: string; sales: number; orders: number }[] }
  | { type: "pnl"; title: string; currency: string; rows: { month: string; sales: number; fees: number; overhead: number; cogs: number; profit: number; orders: number }[]; totals: { sales: number; fees: number; overhead: number; cogs: number; profit: number; orders: number } }
  | { type: "products"; title: string; currency: string; rows: { title: string; listing_id: number; units: number; sales: number; profit: number; margin: number; image: string; prev_units?: number; prev_sales?: number }[] }
  | { type: "movers"; title: string; currency: string; rows: { title: string; listing_id: number; units: number; prev_units: number; sales: number; prev_sales: number; change: number }[] }
  | { type: "orders"; title: string; rows: { receipt_id: number; buyer: string; country: string; date: string; ship_by: string | null; total: number; items: string[] }[] }
  | { type: "listing_draft"; listing_id: number; title: string; edit_url: string; price: [number, number]; quantity: number; tags: string[]; combos: number; image: string | null; images: number; problems: string[]; price_assumed?: boolean; quantity_assumed?: boolean }
  | { type: "status"; title: string; rows: { label: string; value: number }[] }
  | { type: "listing_update"; listing_id: number; title: string; edit_url: string; changes: string[]; tags: string[] }
  | { type: "performance"; title: string; listing_id: number; period: { start: string; end: string }; previous_period: { start: string; end: string }; sales: { units: number; revenue: number; prev_units: number; prev_revenue: number }; views_now: ListingPerformance["views_now"]; conversion_percent: number | null; freshness: ListingPerformance["freshness"]; lifetime: { views: number; favorites: number }; price: number | null }
  | { type: "stale"; title: string; rows: { listing_id: number; title: string; days: number; exact: boolean; units_recent: number; units_previous: number; views: number }[] }
  | { type: "ad_report"; title: string; spend: number; views: number; clicks: number; orders: number; revenue: number; metrics: { ctr_yuzde: number | null; tiklama_basina_maliyet: number | null; roas: number | null; tiklama_siparis_donusumu_yuzde: number | null }; close: string[]; good: string[] };

export interface ChatMessageOut {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  images: { id: string; url: string }[];
  cards: ChatCard[];
}
export interface ChatReply {
  session_id: number;
  title: string;
  user: ChatMessageOut;
  assistant: ChatMessageOut;
}
export interface ChatSessionInfo {
  id: number;
  title: string;
  updated_at: string;
}
export interface AssistantProviders {
  default: string;
  providers: { id: string; label: string; ready: boolean }[];
}
export interface DashboardData {
  currency: string;
  today: { orders: number; sales: number };
  to_ship: number;
  overdue: number;
  month: { label: string; sales: number; orders: number; profit: number; fees: number; cogs: number; prev_sales: number; prev_orders: number; prev_profit: number; costs_entered: boolean };
}

export const api = {
  auth: {
    me: () => request<User>("/api/auth/me"),
    consent: (version: string) => request<User>("/api/auth/consent", { method: "POST", body: JSON.stringify({ version }) }),
    logout: async () => {
      await supabase.auth.signOut();
    },
  },
  account: {
    updateProfile: (name: string) =>
      request<User>("/api/account/profile", { method: "PUT", body: JSON.stringify({ name }) }),
    uploadAvatar: (file: File) => {
      const form = new FormData();
      form.append("avatar", file);
      return requestForm<User>("/api/account/avatar", form);
    },
    ai: () => request<{ enabled: boolean }>("/api/account/ai"),
    setAi: (enabled: boolean) => request<{ enabled: boolean }>("/api/account/ai", { method: "PUT", body: JSON.stringify({ enabled }) }),
    apiKeys: () => request<ApiKeys>("/api/account/api-keys"),
    updateApiKeys: (payload: ApiKeysUpdate) =>
      request<ApiKeys>("/api/account/api-keys", { method: "PUT", body: JSON.stringify(payload) }),
    testApiKey: (provider: "etsy" | "openai" | "anthropic" | "google") =>
      request<ApiKeyTestResult>(`/api/account/api-keys/test/${provider}`, { method: "POST" }),
    /** Şifre Supabase'de tutulur: mevcut şifreyle yeniden giriş doğrulanır, sonra yenisi ayarlanır. */
    changePassword: async (email: string, currentPassword: string, newPassword: string) => {
      const check = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (check.error) throw new Error("Mevcut şifre yanlış");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
    },
    // Geri alınamaz işlemler: hesabın e-postasını yazarak onay + onay kutusu zorunlu.
    resetData: (email: string) =>
      request<{ ok: boolean }>("/api/account/reset-data", { method: "POST", body: JSON.stringify({ email, confirm: true }) }),
    deleteAccount: (email: string) =>
      request<{ ok: boolean }>("/api/account/delete", { method: "POST", body: JSON.stringify({ email, confirm: true }) }),
  },
  shops: {
    list: () => request<Shop[]>("/api/shops"),
    connectUrl: () => `${API_URL}/api/shops/connect/start`,
    /** Etsy bağlantısını keser, Etsy'den gelen önbellek verisini siler. E-posta yazarak onay ister. */
    disconnect: (shopId: number, email: string) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/disconnect`, { method: "POST", body: JSON.stringify({ email, confirm: true }) }),
    /** `currency: null` = otomatik (siparişlerde en çok geçen para birimi); doluysa 3 harfli ISO kod sabitlenir. */
    setCurrency: (shopId: number, currency: string | null) =>
      request<{ ok: boolean; currency: string | null }>(`/api/shops/${shopId}/currency`, {
        method: "PUT",
        body: JSON.stringify({ currency }),
      }),
    shippingProfiles: (shopId: number) =>
      request<ShippingProfile[]>(`/api/shops/${shopId}/shipping-profiles`),
    returnPolicies: (shopId: number) => request<ReturnPolicy[]>(`/api/shops/${shopId}/return-policies`),
    sections: (shopId: number) => request<ShopSection[]>(`/api/shops/${shopId}/sections`),
    profile: (shopId: number) => request<ShopProfile>(`/api/shops/${shopId}/profile`),
    reviews: (shopId: number, opts?: { listingId?: number; rating?: number; month?: string; limit?: number; offset?: number }) =>
      request<{ total: number; average: number | null; reviews: ShopReview[] }>(
        `/api/shops/${shopId}/reviews?${new URLSearchParams({
          ...(opts?.listingId ? { listing_id: String(opts.listingId) } : {}),
          ...(opts?.rating ? { rating: String(opts.rating) } : {}),
          ...(opts?.month ? { month: opts.month } : {}),
          ...(opts?.limit ? { limit: String(opts.limit) } : {}),
          ...(opts?.offset ? { offset: String(opts.offset) } : {}),
        })}`
      ),
    reviewStats: (shopId: number) => request<ShopReviewStats>(`/api/shops/${shopId}/reviews/stats`),
    // Etsy'nin genel API'sinde bölüm sırası (rank) yazılamıyor — yalnızca oluşturma/yeniden adlandırma/silme mümkün.
    createShopSection: (shopId: number, title: string) =>
      request<ShopSection>(`/api/shops/${shopId}/sections`, { method: "POST", body: JSON.stringify({ title }) }),
    updateShopSection: (shopId: number, sectionId: number, title: string) =>
      request<ShopSection>(`/api/shops/${shopId}/sections/${sectionId}`, { method: "PUT", body: JSON.stringify({ title }) }),
    deleteShopSection: (shopId: number, sectionId: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/sections/${sectionId}`, { method: "DELETE" }),
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
      request<{ syncing: boolean; last_synced_at: string | null; done: number | null; total: number | null }>(
        `/api/shops/${shopId}/listings/sync-status`,
      ),
    performance: (shopId: number, listingId: number, start: string, end: string) =>
      request<ListingPerformance>(`/api/shops/${shopId}/listings/${listingId}/performance?start=${start}&end=${end}`),
    history: (shopId: number, listingId: number) =>
      request<ListingHistory>(`/api/shops/${shopId}/listings/${listingId}/history`),
    health: (shopId: number, listingId: number) =>
      request<ListingHealth | null>(`/api/shops/${shopId}/listings/${listingId}/health`),
    shopHealth: (shopId: number) => request<ListingHealth[]>(`/api/shops/${shopId}/listings/health`),
    killListing: (shopId: number, listingId: number) =>
      request<ListingHealth>(`/api/shops/${shopId}/listings/${listingId}/health/kill`, { method: "POST" }),
    keepWatching: (shopId: number, listingId: number) =>
      request<ListingHealth>(`/api/shops/${shopId}/listings/${listingId}/health/keep-watching`, { method: "POST" }),
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
    // Taslak (yeni) fotoğraflar için yapay zekâ alt metin önerisi; Etsy'ye istek atmaz.
    generateAltText: (shopId: number, listingId: number, fileIds: string[], title: string) =>
      request<{ alt_texts: Record<string, string> }>(`/api/shops/${shopId}/listings/${listingId}/draft/alt-text`, {
        method: "POST",
        body: JSON.stringify({ file_ids: fileIds, title }),
      }),
    // Bir fotoğraf yuvasının tüm geçmişi (orijinal + üretilen her sürüm, eskiden yeniye) — hiçbiri silinmez.
    imageVersions: (shopId: number, listingId: number, imageId: number, draftFileId?: string | null) =>
      request<{ versions: ImageVersion[] }>(
        `/api/shops/${shopId}/listings/${listingId}/draft/images/${imageId}/versions${
          draftFileId ? `?draft_file_id=${encodeURIComponent(draftFileId)}` : ""
        }`
      ),
    // Sihirli değnek: bir görseli Gemini ile yeniden oluşturur, yeni bir taslak dosyası döner (orijinali silmez).
    // `referenceDraftFileId`: ör. toplu üretimde daha önce üretilmiş model fotoğrafı — "aynı modeli koru" için.
    // `subjectImageId`/`subjectDraftFileId`: sahnede birden fazla obje olduğunda "ürün bu" diye işaret eden,
    // listing'in kendi fotoğraflarından biri (net/temiz ürün karesi).
    regenerateImage: (
      shopId: number,
      listingId: number,
      imageId: number,
      draftFileId: string | null,
      opts?: {
        prompt?: string;
        referenceDraftFileId?: string;
        cameraPrompt?: string;
        distancePrompt?: string;
        subjectImageId?: number;
        subjectDraftFileId?: string;
      }
    ) =>
      request<{ file_id: string; kind: string; filename: string }>(
        `/api/shops/${shopId}/listings/${listingId}/draft/images/regenerate`,
        {
          method: "POST",
          body: JSON.stringify({
            image_id: imageId,
            draft_file_id: draftFileId,
            prompt: opts?.prompt || undefined,
            reference_draft_file_id: opts?.referenceDraftFileId || undefined,
            camera_prompt: opts?.cameraPrompt || undefined,
            distance_prompt: opts?.distancePrompt || undefined,
            subject_image_id: opts?.subjectImageId ?? undefined,
            subject_draft_file_id: opts?.subjectDraftFileId || undefined,
          }),
        }
      ),
    // AI ile oluştur: kaynak fotoğraf olmadan, yalnızca yazılan talimattan yeni bir taslak fotoğrafı üretir.
    generateImage: (shopId: number, listingId: number, prompt: string, referenceDraftFileId?: string) =>
      request<{ file_id: string; kind: string; filename: string }>(
        `/api/shops/${shopId}/listings/${listingId}/draft/images/generate`,
        {
          method: "POST",
          body: JSON.stringify({ prompt, reference_draft_file_id: referenceDraftFileId || undefined }),
        }
      ),
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
  assistant: {
    providers: (shopId: number) => request<AssistantProviders>(`/api/shops/${shopId}/assistant/providers`),
    progress: (shopId: number, requestId: string) => request<{ step: string }>(`/api/shops/${shopId}/assistant/progress/${requestId}`),
    chat: (shopId: number, body: { message: string; session_id?: number | null; image_ids: string[]; provider?: string; today: string; request_id?: string }) =>
      request<ChatReply>(`/api/shops/${shopId}/assistant/chat`, { method: "POST", body: JSON.stringify(body) }),
    sessions: (shopId: number) => request<ChatSessionInfo[]>(`/api/shops/${shopId}/assistant/sessions`),
    session: (shopId: number, id: number) => request<{ id: number; title: string; messages: ChatMessageOut[] }>(`/api/shops/${shopId}/assistant/sessions/${id}`),
    deleteSessions: (shopId: number, ids: number[] | null) =>
      request<{ deleted: number }>(`/api/shops/${shopId}/assistant/sessions/bulk-delete`, {
        method: "POST",
        body: JSON.stringify(ids === null ? { all: true } : { ids }),
      }),
    deleteSession: (shopId: number, id: number) => request<{ ok: boolean }>(`/api/shops/${shopId}/assistant/sessions/${id}`, { method: "DELETE" }),
    uploadImage: (shopId: number, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return requestForm<{ id: string; filename: string; url: string }>(`/api/shops/${shopId}/assistant/images`, fd);
    },
    dashboard: (shopId: number, today: string) => request<DashboardData>(`/api/shops/${shopId}/assistant/dashboard?today=${today}`),
  },
  finance: {
    /** Gerçek kur verisi bulunan, dolayısıyla mağaza para birimi olarak seçilebilecek kodlar. */
    availableCurrencies: (shopId: number) => request<{ currencies: string[] }>(`/api/shops/${shopId}/finance/available-currencies`),
    report: (shopId: number, start: string, end: string, country = "", compare: number[] = [1]) =>
      request<FinReport>(`/api/shops/${shopId}/finance/report?start=${start}&end=${end}&compare=${compare.join(",")}${country ? `&country=${country}` : ""}`),
    exportXlsx: async (shopId: number, start: string, end: string, country = "", opts: { scope?: string; q?: string; sort?: string } = {}) => {
      const params = new URLSearchParams({ start, end, scope: opts.scope ?? "all", sort: opts.sort ?? "sales" });
      if (country) params.set("country", country);
      if (opts.q) params.set("q", opts.q);
      const res = await send(`${API_URL}/api/shops/${shopId}/finance/export.xlsx?${params}`, {
        headers: await authHeader(),
      });
      if (!res.ok) throw new Error("Excel oluşturulamadı");
      return res.blob();
    },
    syncStatus: (shopId: number) => request<FinSyncStatus>(`/api/shops/${shopId}/finance/sync-status`),
    sync: (shopId: number, full = false) => request<FinSyncStatus>(`/api/shops/${shopId}/finance/sync?full=${full}`, { method: "POST" }),
    setCost: (shopId: number, listingId: number, unitCost: number, shippingCost: number, costPct = 0) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/finance/costs/${listingId}`, {
        method: "PUT",
        body: JSON.stringify({ unit_cost: unitCost, shipping_cost: shippingCost, cost_pct: costPct }),
      }),
    setVariantCost: (shopId: number, listingId: number, key: string, unitCost: number, shippingCost: number, costPct = 0) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/finance/costs/${listingId}/variant`, {
        method: "PUT",
        body: JSON.stringify({ key, unit_cost: unitCost, shipping_cost: shippingCost, cost_pct: costPct }),
      }),
    orders: (shopId: number, start: string, end: string, q = "", page = 0) =>
      request<FinOrdersPage>(`/api/shops/${shopId}/finance/orders?start=${start}&end=${end}&q=${encodeURIComponent(q)}&page=${page}`),
    orderDetail: (shopId: number, receiptId: number) => request<FinOrderDetail>(`/api/shops/${shopId}/finance/orders/${receiptId}`),
    setOrderFixedCost: (shopId: number, amount: number) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/finance/settings/order-cost`, {
        method: "PUT",
        body: JSON.stringify({ amount }),
      }),
    setOrderCost: (shopId: number, receiptId: number, cost: number | null) =>
      request<{ ok: boolean }>(`/api/shops/${shopId}/finance/orders/${receiptId}/cost`, {
        method: "PUT",
        body: JSON.stringify({ cost }),
      }),
    invoices: {
      // Dosyayı okuyup çıkarılan kalemleri döner — HENÜZ kaydetmez (onay ekranı için).
      parse: (shopId: number, file: File) => {
        const form = new FormData();
        form.append("file", file, file.name);
        return requestForm<InvoiceCandidate[]>(`/api/shops/${shopId}/finance/invoices/parse`, form);
      },
      confirm: (shopId: number, receiptId: number, candidate: InvoiceCandidate) =>
        request<{ ids: number[] }>(`/api/shops/${shopId}/finance/invoices/confirm`, {
          method: "POST",
          body: JSON.stringify({ receipt_id: receiptId, candidate }),
        }),
      list: (shopId: number, f: InvoiceQuery = {}) => {
        const params = new URLSearchParams({ sort: f.sort ?? "inv_date", page: String(f.page ?? 0), per_page: String(f.perPage ?? 20) });
        const map: [string, string | undefined][] = [["q", f.q], ["kind", f.kind], ["inv_start", f.invStart], ["inv_end", f.invEnd], ["order_start", f.orderStart], ["order_end", f.orderEnd]];
        for (const [k, v] of map) if (v) params.set(k, v);
        return request<InvoicePage>(`/api/shops/${shopId}/finance/invoices?${params}`);
      },
      removeMany: (shopId: number, ids: number[]) =>
        request<{ deleted: number }>(`/api/shops/${shopId}/finance/invoices/delete`, { method: "POST", body: JSON.stringify({ ids }) }),
      remove: (shopId: number, id: number) =>
        request<{ ok: boolean }>(`/api/shops/${shopId}/finance/invoices/${id}`, { method: "DELETE" }),
    },
  },
};

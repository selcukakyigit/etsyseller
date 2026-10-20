import { API_URL, apiRequest, apiUpload } from "@/lib/api";

/** Her modülün miras aldığı ortak uç noktaların istemcisi (backend/app/modkit/routes.py ile birebir).
 * Bir modül `entityApi("/api/supply")` ile bunu alır, üstüne kendi uç noktalarını ekler. */

export type Role = "member" | "viewer" | "guest";
export type GuestPerm = "prices.edit" | "jobs.create" | "documents.upload";
export const GUEST_PERMS: GuestPerm[] = ["prices.edit", "jobs.create", "documents.upload"];

export interface EntityAccess {
  role: Role;
  permissions: GuestPerm[];
}

export interface Entity {
  id: number;
  module: string;
  name: string;
  label: string;
  currency: string;
  vat_rate: number;
  vat_in_cost: boolean;
  archived: boolean;
  /** Logo / profil resminin sürüm eki (yoksa null); adres `entityApi(...).imageUrl` ile kurulur. */
  image: string | null;
  created_at: string;
  contact_email?: string;
  note?: string;
  access?: EntityAccess;
  role?: Role;
}

export interface EntityList {
  own: (Entity & { role: Role })[];
  shared: { id: number; name: string; label: string; currency: string; image: string | null; role: "guest" }[];
}

export type EntityInput = { name: string; label?: string; currency?: string; vat_rate?: number; vat_in_cost?: boolean; contact_email?: string; note?: string };

export type PriceKind = "service" | "material" | "fee" | "minimum";

export interface PriceItem {
  id: number;
  kind: PriceKind;
  name: string;
  unit: string;
  spec: string;
  position: number;
  archived: boolean;
  price: number | null;
  price_from: string | null;
  price_source: "owner" | "guest" | null;
  versions: number;
  /** Tüketim kuralı: doluysa kalem her yeni işe bu miktarla kendiliğinden eklenir. */
  auto_qty: number | null;
  /** Yalnızca malzeme kalemleri: tür, kalınlık, plaka boyutu/ağırlığı ve fiyattan türetilen kg / plaka fiyatı. */
  material?: string | null;
  thickness_mm?: number | null;
  plate_width?: number | null;
  plate_height?: number | null;
  plate_kg?: number | null;
  roll_width?: number | null;
  film_um?: number | null;
  roll_length?: number | null;
  /** Rulo bilgisiyle metreye çevrilebiliyor: paket formülünde miktar metre yazılır. */
  by_length?: boolean;
  derived?: { kg: number | null; plate: number | null } | null;
  /** Türün grubu (backend `materials.group_of`) ve maliyet/eşleşme için eksik kalan bilgiler: "material" | "thickness_mm" | "plate". */
  group?: MaterialGroup | null;
  missing?: string[];
  /** Stok (yalnızca çalışma alanı üyesine gelir; yalnızca malzeme kalemlerinde). Miktarlar kalemin biriminde. */
  track_stock?: boolean;
  min_stock?: number | null;
  pack_size?: number | null;
  entry_units?: string[];
  on_hand?: number;
  avg_cost?: number | null;
  ref?: number;
  level?: StockLevel;
}

export type StockLevel = "ok" | "low" | "out";

/** Stok ayarları (kalem formunda): takip, paket miktarı, en az stok (null = boşalt). */
export interface TrackingPatch {
  track_stock?: boolean;
  min_stock?: number | null;
  pack_size?: number | null;
}

export interface StockMovement {
  id: number;
  kind: "opening" | "purchase" | "use" | "adjust";
  qty: number;
  unit_cost: number | null;
  moved_on: string;
  ref_type: string;
  ref_id: number | null;
  note: string;
  by: string;
}

export type MaterialGroup = "sheet" | "film" | "piece" | "bulk";

/** Malzeme türü kataloğundaki bir satır: yerleşik ya da kullanıcının kendi türü (backend `material_types.catalog`). */
export interface MaterialTypeInfo {
  key: string;
  tr: string;
  en: string;
  group: MaterialGroup;
  builtin: boolean;
  density: number | null;
  /** Kaç kalemde ve ürün parçasında kullanılıyor (yalnızca kullanıcı türlerinde dolu). */
  used: number;
}

/** Grup kuralları: bu grupta seçilebilen birimler ve birime göre sorulan alanlar. */
export type MaterialRules = Record<MaterialGroup, { units: string[]; fields: Record<string, string[]> }>;
export interface MaterialCatalog {
  types: MaterialTypeInfo[];
  groups: MaterialRules;
}

/** Malzeme kalemi alanları (null = alanı boşalt). */
export interface StockPatch {
  material?: string | null;
  thickness_mm?: number | null;
  plate_width?: number | null;
  plate_height?: number | null;
  plate_kg?: number | null;
  roll_width?: number | null;
  film_um?: number | null;
  roll_length?: number | null;
}

export interface PriceVersion {
  id: number;
  price: number;
  valid_from: string;
  source: "owner" | "guest";
  by: string;
}

export interface Activity {
  id: number;
  kind: string;
  data: Record<string, unknown>;
  actor: string;
  created_at: string;
}

export interface DocumentRow {
  id: number;
  filename: string;
  content_type: string;
  size: number;
  profile: string;
  source: string;
  has_data: boolean;
  /** Dosya depoda mı: okunan belgenin dosyası saklanmaz, yalnızca okuma başarısız olduysa yeniden denemek için durur. */
  has_file: boolean;
  uploaded_by: string;
  created_at: string;
}

/** Dış pay sahibi: maliyetin kendi mağazalarına yazılmayan payının sahibi (başka hesaptaki mağaza, yerel satış…). Çalışma alanı seviyesinde, modüller arası ortak. */
export interface ExternalParty {
  id: number;
  name: string;
  archived: boolean;
}

export interface SharingOverview {
  invites: { id: number; email: string; permissions: GuestPerm[]; status: "pending" | "expired"; expires_at: string; created_at: string }[];
  grants: { id: number; email: string; name: string; permissions: GuestPerm[]; created_at: string }[];
}

export interface Mapping {
  profile: string;
  field_key: string;
  price_item_id: number;
}

/** Bir ürünün bu kayıttaki üretim ölçüsü anahtarları (backend/app/modkit/products.py MEASURES). Uzunluklar mm. */
export type MeasureKey = "cut_length" | "pierce_count" | "width" | "height" | "surface" | "sides" | "thickness" | "part_qty";

/** Bir ürünün sayısal ölçüleri (uzunluk mm, `surface` mm², adet). Malzeme türü ayrıdır: `ProductMeasureRow.material`. */
export type MeasureValues = Partial<Record<MeasureKey, number>>;

export interface MeasuresBody {
  values: Partial<Record<MeasureKey, number | null>>;
  material?: string | null;
}

export interface ProductMeasureRow {
  shop_id: number;
  shop_name: string;
  listing_id: number;
  /** Listing içindeki seçenek (ebat/varyasyon; Etsy envanterinden); "" = tüm ürün. */
  variant: string;
  /** Ürünün parçası: çok parçalı üründe her parçanın kendi ebadı ve malzemesi vardır (tek parçalı üründe 0). */
  part: number;
  title: string;
  values: MeasureValues;
  /** Malzeme türü anahtarı ("dkp", "aluminium"…); kalınlık `values.thickness`'ta. Tedarikçiden bağımsızdır. */
  material: string | null;
  source: "manual" | "cad";
  updated_at: string;
}

/** Çizim dosyasından yapılan ölçümün ayrıntısı (kaydedilen değerlerin yanında uyarı için döner). */
export interface CadInfo {
  cut_length_mm: number;
  pierce_count: number;
  width_mm: number;
  height_mm: number;
  entities: number;
  units_assumed: boolean;
  /** Net yüzey alanı (mm²); hesaplanamazsa null. */
  area_mm2: number | null;
}

/** Plaka çiziminin bir grubu: konumlarına göre bir arada duran şekiller (bir ürün ya da parça takımı). */
export interface SheetGroup extends CadInfo {
  index: number;
  shapes: number;
  /** Önizleme için SVG yolu (milimetre, y çevrilmiş). */
  path: string;
  box: [number, number, number, number];
  /** Daha önce tanıtılmış ve bu gruba ebat/uzunlukça uyan ürün. */
  known: { shop_id: number; listing_id: number; variant: string; part: number; title: string } | null;
}

export interface SheetAnalysis {
  total: CadInfo;
  gap_mm: number;
  groups: SheetGroup[];
  viewbox: [number, number, number, number];
}

/** Mağaza ürün seçicisindeki bir ürün: `used` = bu kayıtta ölçüsü girilmiş, `variants` = Etsy envanterindeki seçenek (ebat) sayısı. */
export interface ListingOption {
  listing_id: number;
  title: string;
  price: number;
  image: string;
  variants: number;
  used: boolean;
}

export interface ListingSection {
  id: number;
  title: string;
  count: number;
  used: number;
}

export interface InviteInfo {
  status: "pending" | "accepted" | "expired" | "revoked";
  email: string;
  module: string;
  entity_name: string;
  workspace_name: string;
  inviter: string;
  expires_at: string;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });
/** Ürün (seçenek) ve parça sorgusu: boş değerler eklenmez. */
const variantQuery = (variant: string, part?: number) => {
  const q = [variant ? `variant=${encodeURIComponent(variant)}` : "", part ? `part=${part}` : ""].filter(Boolean).join("&");
  return q ? `?${q}` : "";
};

export function entityApi<TEntity extends Entity = Entity, TSummary = unknown>(base: string) {
  const one = (id: number) => `${base}/${id}`;
  return {
    base,
    list: () => apiRequest<EntityList>(base),
    create: (input: EntityInput) => apiRequest<TEntity>(base, { method: "POST", ...json(input) }),
    get: (id: number) => apiRequest<TEntity & { summary?: TSummary }>(one(id)),
    update: (id: number, input: Partial<EntityInput>) => apiRequest<TEntity>(one(id), { method: "PATCH", ...json(input) }),
    archive: (id: number, archived: boolean) => apiRequest<{ ok: true }>(`${one(id)}/archive`, { method: "POST", ...json({ archived }) }),
    remove: (id: number, confirmName: string) => apiRequest<{ ok: true }>(`${one(id)}/delete`, { method: "POST", ...json({ confirm_name: confirmName }) }),
    activity: (id: number) => apiRequest<{ items: Activity[] }>(`${one(id)}/activity`),
    /** Logo adresi; sürüm eki değişince tarayıcı yenisini çeker. */
    imageUrl: (id: number, version: string) => `${API_URL}${one(id)}/image?v=${encodeURIComponent(version)}`,
    uploadImage: (id: number, file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return apiUpload<TEntity>(`${one(id)}/image`, form);
    },
    removeImage: (id: number) => apiRequest<TEntity>(`${one(id)}/image`, { method: "DELETE" }),

    prices: {
      list: (id: number, archived = false) => apiRequest<{ items: PriceItem[] }>(`${one(id)}/prices${archived ? "?archived=true" : ""}`),
      add: (id: number, item: { kind: PriceKind; name: string; unit: string; spec?: string; price: number; auto_qty?: number | null; opening_stock?: number } & StockPatch & TrackingPatch) =>
        apiRequest<PriceItem>(`${one(id)}/prices`, { method: "POST", ...json(item) }),
      update: (id: number, itemId: number, patch: { name?: string; spec?: string; auto_qty?: number | null; unit?: string } & StockPatch & TrackingPatch) =>
        apiRequest<{ ok: true }>(`${one(id)}/prices/${itemId}`, { method: "PATCH", ...json(patch) }),
      setPrice: (id: number, itemId: number, price: number, validFrom?: string) =>
        apiRequest<{ ok: true }>(`${one(id)}/prices/${itemId}/price`, { method: "POST", ...json({ price, valid_from: validFrom || null }) }),
      history: (id: number, itemId: number) => apiRequest<{ items: PriceVersion[] }>(`${one(id)}/prices/${itemId}/history`),
      archive: (id: number, itemId: number, archived: boolean) =>
        apiRequest<{ ok: true }>(`${one(id)}/prices/${itemId}/archive`, { method: "POST", ...json({ archived }) }),
      remove: (id: number, itemId: number) => apiRequest<{ ok: true }>(`${one(id)}/prices/${itemId}`, { method: "DELETE" }),
      stockHistory: (id: number, itemId: number) => apiRequest<{ items: StockMovement[] }>(`${one(id)}/prices/${itemId}/stock`),
      /** Alım / giriş: miktar `unit` biriminde (kalemin birimi, aynı boyuttaki bir birim ya da "pack"); tutar toplam ya da birim başına. */
      stockIn: (id: number, itemId: number, body: { qty: number; unit: string; total?: number | null; unit_price?: number | null; vat_included?: boolean; update_price?: boolean; date?: string | null; note?: string }) =>
        apiRequest<PriceItem>(`${one(id)}/prices/${itemId}/stock/in`, { method: "POST", ...json(body) }),
      /** Sayım düzeltmesi: gerçekte eldeki miktar. */
      stockCount: (id: number, itemId: number, body: { counted: number; unit: string; date?: string | null; note?: string }) =>
        apiRequest<PriceItem>(`${one(id)}/prices/${itemId}/stock/count`, { method: "POST", ...json(body) }),
    },

    materialTypes: {
      list: (id: number) => apiRequest<MaterialCatalog>(`${one(id)}/material-types`),
      add: (id: number, body: { name: string; group: MaterialGroup; density?: number | null }) =>
        apiRequest<MaterialTypeInfo>(`${one(id)}/material-types`, { method: "POST", ...json(body) }),
      remove: (id: number, key: string) => apiRequest<{ items: number; parts: number }>(`${one(id)}/material-types/${encodeURIComponent(key)}`, { method: "DELETE" }),
    },

    mappings: {
      list: (id: number) => apiRequest<{ items: Mapping[] }>(`${one(id)}/mappings`),
      set: (id: number, profile: string, fieldKey: string, priceItemId: number | null) =>
        apiRequest<{ ok: true }>(`${one(id)}/mappings`, { method: "PUT", ...json({ profile, field_key: fieldKey, price_item_id: priceItemId }) }),
    },

    documents: {
      list: (id: number) => apiRequest<{ items: DocumentRow[] }>(`${one(id)}/documents`),
      fileUrl: (id: number, docId: number) => `${API_URL}${one(id)}/documents/${docId}/file`,
      remove: (id: number, docId: number) => apiRequest<{ ok: true }>(`${one(id)}/documents/${docId}`, { method: "DELETE" }),
    },

    parties: {
      list: (id: number) => apiRequest<{ items: ExternalParty[] }>(`${one(id)}/parties`),
      create: (id: number, name: string) => apiRequest<ExternalParty>(`${one(id)}/parties`, { method: "POST", ...json({ name }) }),
      update: (id: number, partyId: number, body: { name?: string; archived?: boolean }) => apiRequest<ExternalParty>(`${one(id)}/parties/${partyId}`, { method: "PATCH", ...json(body) }),
    },

    /** Çalışma alanının mağazaları ve ürün arama (yalnızca üye): maliyet paylaştırma ve ürün ölçüleri için. */
    shops: (id: number) => apiRequest<{ items: { id: number; name: string }[] }>(`${one(id)}/shops`),
    /** Listing'in seçenekleri (ebat/varyasyon; Etsy envanteri). Seçenek yoksa boş liste. */
    variants: (id: number, shopId: number, listingId: number) => apiRequest<{ items: { key: string }[] }>(`${one(id)}/listings/${shopId}/${listingId}/variants`),
    /** Mağaza bölümleri ve ürün sayıları (`id` 0 = bölümsüz). Seçici önce bunları gösterir. */
    listingSections: (id: number, shopId: number) => apiRequest<{ items: ListingSection[] }>(`${one(id)}/listing-sections?shop_id=${shopId}`),
    /** Mağaza ürünleri, sayfa sayfa. `section`: yalnızca o bölüm (0 = bölümsüz); verilmezse hepsi. */
    listings: (id: number, shopId: number, q: string, section?: number, offset = 0) =>
      apiRequest<{ items: ListingOption[]; more: boolean }>(
        `${one(id)}/listings?shop_id=${shopId}&q=${encodeURIComponent(q)}${section !== undefined ? `&section=${section}` : ""}${offset ? `&offset=${offset}` : ""}`,
      ),

    measures: {
      list: (id: number) => apiRequest<{ items: ProductMeasureRow[] }>(`${one(id)}/product-measures`),
      /** Ürünün bir parçasının ölçülerini yazar; `material` (tür anahtarı) verilirse o da, null ise kaldırılır, verilmezse dokunulmaz. */
      set: (id: number, shopId: number, listingId: number, body: MeasuresBody, source: "manual" | "cad" = "manual", variant = "", part = 0) =>
        apiRequest<ProductMeasureRow>(`${one(id)}/product-measures/${shopId}/${listingId}${variantQuery(variant, part)}`, { method: "PUT", ...json({ ...body, source }) }),
      /** Plaka çizimini (birden çok ürün) gruplara ayırır; kaydetmez. */
      sheet: (id: number, file: File, gap: number) => {
        const form = new FormData();
        form.append("file", file, file.name);
        return apiUpload<SheetAnalysis>(`${one(id)}/drawings/sheet?gap=${gap}`, form);
      },
      /** DXF çizimini ölçer ve ürüne yazar. */
      drawing: (id: number, shopId: number, listingId: number, file: File, variant = "", part = 0) => {
        const form = new FormData();
        form.append("file", file, file.name);
        return apiUpload<ProductMeasureRow & { cad: CadInfo }>(`${one(id)}/product-measures/${shopId}/${listingId}/drawing${variantQuery(variant, part)}`, form);
      },
      /** Ürünü listeden çıkarır; `part` verilirse yalnızca o parçayı. */
      remove: (id: number, shopId: number, listingId: number, variant = "", part?: number) =>
        apiRequest<{ ok: true }>(`${one(id)}/product-measures/${shopId}/${listingId}${variantQuery(variant, part)}`, { method: "DELETE" }),
    },

    sharing: {
      overview: (id: number) => apiRequest<SharingOverview>(`${one(id)}/sharing`),
      invite: (id: number, email: string, permissions: GuestPerm[]) =>
        apiRequest<{ id: number; sent: boolean }>(`${one(id)}/invites`, { method: "POST", ...json({ email, permissions }) }),
      resend: (id: number, inviteId: number) => apiRequest<{ id: number; sent: boolean }>(`${one(id)}/invites/${inviteId}/resend`, { method: "POST" }),
      revoke: (id: number, inviteId: number) => apiRequest<{ ok: true }>(`${one(id)}/invites/${inviteId}`, { method: "DELETE" }),
      updateGrant: (id: number, grantId: number, permissions: GuestPerm[]) =>
        apiRequest<{ ok: true }>(`${one(id)}/grants/${grantId}`, { method: "PATCH", ...json({ permissions }) }),
      removeGrant: (id: number, grantId: number) => apiRequest<{ ok: true }>(`${one(id)}/grants/${grantId}`, { method: "DELETE" }),
      leave: (id: number) => apiRequest<{ ok: true }>(`${one(id)}/leave`, { method: "POST" }),
    },
  };
}

export type EntityApi = ReturnType<typeof entityApi>;

/** Modüllerden bağımsız çekirdek uç noktaları. */
export const modkitApi = {
  currencies: () => apiRequest<{ items: string[]; default: string }>("/api/modkit/currencies"),
};

/** Davet bağlantısı modülden bağımsızdır. */
export const invitesApi = {
  lookup: (token: string) => apiRequest<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`),
  accept: (token: string) => apiRequest<{ module: string; entity_id: number }>(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST" }),
};

/** Erişim yardımcıları (backend/app/modkit/access.py ile aynı kurallar; asıl kontrol sunucuda). */
export function can(access: EntityAccess | undefined, perm: GuestPerm): boolean {
  if (!access) return false;
  if (access.role === "member") return true;
  return access.role === "guest" && access.permissions.includes(perm);
}

export const isMember = (access: EntityAccess | undefined) => access?.role === "member";
export const isInternal = (access: EntityAccess | undefined) => access?.role === "member" || access?.role === "viewer";

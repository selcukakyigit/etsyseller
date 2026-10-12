import { apiRequest, apiUpload } from "@/lib/api";
import { DocumentRow, Entity, entityApi } from "../core/api";

/** Dış Tedarik istemcisi: ortak uç noktalar `entityApi`'den miras, üstüne işler / dağıtım / belge okuma. */

export const MODULE_PATH = "/supply";
export const PROFILE = "supply_document";

export type JobStatus = "draft" | "submitted" | "confirmed" | "disputed";

export interface SupplySummary {
  jobs: number;
  draft: number;
  submitted: number;
  disputed: number;
  confirmed: number;
  month_cost: number;
  price_items: number;
  last_price_change: string | null;
}

export interface Measure {
  key: string;
  label: string;
  text: string;
  value: number;
  unit: string;
}

export interface DocLine {
  key: string;
  description: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number | null;
}

export interface DocData {
  doc_type: string;
  doc_number: string | null;
  date: string | null;
  vendor: string | null;
  currency: string | null;
  measures: Measure[];
  lines: DocLine[];
  net: number | null;
  vat: number | null;
  total: number | null;
  vat_rate: number | null;
  info: { label: string; text: string }[];
}

export interface Job {
  id: number;
  number: number;
  title: string;
  job_date: string;
  status: JobStatus;
  currency: string;
  vat_rate: number;
  estimate: number;
  actual: number | null;
  basis: number;
  created_via: "owner" | "guest";
  document_id: number | null;
  dispute_note: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Onaylanmış işin ürün payları: toplam ve Finans'a henüz uygulanmamış olanların sayısı (yalnızca üye). */
  product_costs?: { total: number; pending: number };
}

export interface JobLine {
  id?: number;
  price_item_id: number | null;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  manual_price: boolean;
  amount?: number;
  source_key: string;
}

export interface PlanTarget {
  /** Dış payda 0; `party_id` doludur. */
  shop_id: number;
  /** Dış pay sahibi (mağazalara yazılmaz). */
  party_id?: number | null;
  listing_id: number | null;
  /** Listing içindeki seçenek (ebat); "" = tüm ürün. */
  variant: string;
  title: string;
  qty: number;
  price: number;
  amount: number | null;
  /** Boyacıda: ürünün boya türü (boyacının fiyat listesindeki m² kalemi). */
  item_id?: number | null;
  share?: number | null;
  unit_share?: number | null;
  /** Tahmini maliyete göre dağıtımda payın dayandığı lazer + malzeme tahmini. */
  estimate?: { laser: number; material: number };
  /** Payın mağazanın rapor para birimindeki karşılığı (Finans'a yazılacak tutar) ve işin tarihindeki kur; para birimi aynıysa yoktur. */
  report?: { amount: number; currency: string; rate: number } | null;
  /** Ürünün kullandığı malzeme (parça başına tür, kalınlık, kg ve malzeme fiyatı; adet dahil toplam); tanımlı değilse null. */
  material?: { parts: { name: string; type: string | null; thickness: number | null; qty: number; kg: number | null; cost: number | null }[]; kg: number; cost: number } | null;
}

export interface Allocation {
  id: number;
  /** Dış payda null; `party_id` doludur. */
  shop_id: number | null;
  party_id: number | null;
  listing_id: number | null;
  variant: string;
  title: string;
  qty: number;
  amount: number;
  amount_report: number;
  report_ccy: string;
  applied_at: string | null;
}

export interface JobDetail extends Job {
  note: string;
  lines: JobLine[];
  estimate_totals: { lines: number; minimum_adjust: number; net: number; vat: number; total: number };
  actual_totals: { net: number; vat: number; total: number } | null;
  diff: number | null;
  vat_in_cost: boolean;
  document: (DocumentRow & { data: DocData | null }) | null;
  plan?: { mode: SplitMode; targets: PlanTarget[]; remainder_party_id?: number | null };
  allocations?: Allocation[];
  /** Tahmini dağıtım ayarları (yalnızca üye): elle yazılan süre bedeli, süre ölçüsüne eşlenen satırların toplamı, malzeme kesimciden mi, raporun süreleri. */
  /** Dağıtım hedeflerinin kullandığı malzemenin tahmini (malzeme kalemi başına toplam); yalnızca üye ve malzeme kesimciden ise. */
  materials?: { total: number; items: { name: string; type: string | null; thickness: number | null; kg: number; cost: number }[] };
  time_fee?: number | null;
  time_fee_mapped?: number | null;
  with_material?: boolean;
  times?: { key: string; label: string; seconds: number }[];
  /** Aynı tarihli ve aynı tutarlı diğer işler (olası mükerrer); yalnızca üyeye gelir. */
  similar?: { id: number; number: number; title: string; status: JobStatus }[];
}

/** Belge satırı/notu ile uyuşan ürün önerisi: ebat ("size") ya da ad benzerliği ("name"). */
export interface Suggestion {
  line: string;
  amount: number | null;
  matches: { shop_id: number; listing_id: number; variant: string; title: string; reason: "size" | "name" }[];
}

/** Paylaştırma türü: fiyat/adet/elle ya da bir ürün ölçüsüne (kesim uzunluğu, delme, alan) göre. */
export type SplitMode = "price" | "qty" | "manual" | "cut_length" | "pierce_count" | "paint_area" | "paint_rate" | "estimated";

/** Ürünlerin toplam ölçüsü ile belgedeki (makine raporu) toplamın karşılaştırması. */
export interface MeasureCheck {
  measure: "cut_length" | "pierce_count";
  expected: number;
  actual: number;
  diff_pct: number;
}

export interface PlanPreview {
  mode: SplitMode;
  basis: number;
  currency: string;
  error: string | null;
  check: MeasureCheck | null;
  /** Tahmini ve m² fiyatlı dağıtımda işin tutarından dağıtılmayan kısım (negatif: paylar tutardan fazla). */
  unallocated?: number | null;
  /** Dağıtılmayan kalanın yazılacağı dış pay sahibi ve tutarı (seçilmediyse null). */
  remainder?: { party_id: number; amount: number } | null;
  /** m² fiyatlı dağıtımda seçilebilen boya türleri. */
  paint_items?: { id: number; name: string }[] | null;
  targets: PlanTarget[];
}

export interface AnalyzeResult {
  document: DocumentRow & { data: DocData | null };
  job: JobDetail | null;
  error: string | null;
  /** Yükleme notu yorumlanamadı (belge yine de işlendi). */
  note_error?: string | null;
  /** Aynı içerik bu kayıtta zaten vardı: yeni belge/iş açılmadı, var olanlar döndü. */
  duplicate?: boolean;
}

export interface SupplyReport {
  currency: string;
  jobs: number;
  confirmed: number;
  /** Dönemdeki işlerin durum sayıları. */
  statuses: { draft: number; submitted: number; disputed: number; confirmed: number };
  cost: number;
  estimate_total: number;
  actual_total: number;
  /** Maliyetin malzeme / hizmet / sabit ücret dağılımı (toplam maliyete eşit). */
  material: number;
  service: number;
  fee: number;
  /** Dış pay sahiplerine düşen paylar (onaylanan işlerde; iş para biriminde). */
  external: { party_id: number; name: string; amount: number; jobs: number }[];
  months: { month: string; cost: number; estimate: number; actual: number; jobs: number; material: number; service: number; fee: number }[];
  usage: { price_item_id: number | null; description: string; unit: string; qty: number; amount: number; avg_unit_price: number | null }[];
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });
const base = "/api/supply";
const one = (id: number) => `${base}/${id}`;

/** Ambalaj: paket türü satırı (miktar = sabit + a × uzun kenar + b × kısa kenar + c × alan; metre ve m²). */
export interface PackageLineBody {
  price_item_id: number;
  constant: number;
  per_long: number;
  per_short: number;
  per_area: number;
}

export interface PackageLine extends PackageLineBody {
  id: number;
  item_name: string;
  unit: string;
}

export interface PackageType {
  id: number;
  entity_id: number;
  entity_name: string;
  /** Bu tedarikçi kaydına ait mi (yalnızca kendininkini düzenler). */
  own: boolean;
  name: string;
  is_default: boolean;
  lines: PackageLine[];
}

export interface PackagePreview {
  lines: { item_id: number; name: string; unit: string; qty: number; missing: "plate" | "thickness" | null; metres: number | null; unit_price: number; cost: number }[];
  total: number;
}

/** Tanımlı bir ürünün paketi: elle atananlar, "ambalajsız" mı, geçerli olanlar (varsayılan dahil) ve toplam ambalaj maliyeti. */
export interface ProductPackageRow {
  shop_id: number;
  listing_id: number;
  variant: string;
  title: string;
  package_ids: number[];
  none: boolean;
  resolved_ids: number[];
  cost: number | null;
}

export interface PackageApplyRow {
  shop_id: number;
  listing_id: number;
  variant: string;
  title: string;
  /** Mağazanın rapor para birimi; old/new bu birimde, source_new tedarikçinin para biriminde. */
  currency: string;
  old: number;
  new: number;
  source_new: number;
}

export const supplyApi = {
  ...entityApi<Entity, SupplySummary>(base),
  jobs: {
    list: (id: number, f: { status?: string; q?: string; page?: number } = {}) => {
      const p = new URLSearchParams({ page: String(f.page ?? 0) });
      if (f.status) p.set("status", f.status);
      if (f.q) p.set("q", f.q);
      return apiRequest<{ items: Job[]; total: number }>(`${one(id)}/jobs?${p}`);
    },
    create: (id: number, input: { title: string; job_date?: string; note?: string }) =>
      apiRequest<JobDetail>(`${one(id)}/jobs`, { method: "POST", ...json(input) }),
    get: (id: number, jobId: number) => apiRequest<JobDetail>(`${one(id)}/jobs/${jobId}`),
    update: (id: number, jobId: number, patch: { title?: string; job_date?: string; note?: string; vat_rate?: number; actual?: number | null; time_fee?: number | null; with_material?: boolean }) =>
      apiRequest<JobDetail>(`${one(id)}/jobs/${jobId}`, { method: "PATCH", ...json(patch) }),
    setLines: (id: number, jobId: number, lines: JobLine[]) =>
      apiRequest<JobDetail>(`${one(id)}/jobs/${jobId}/lines`, { method: "PUT", ...json({ lines }) }),
    rebuild: (id: number, jobId: number) => apiRequest<JobDetail>(`${one(id)}/jobs/${jobId}/rebuild`, { method: "POST" }),
    submit: (id: number, jobId: number) => apiRequest<JobDetail>(`${one(id)}/jobs/${jobId}/submit`, { method: "POST" }),
    dispute: (id: number, jobId: number, note: string) => apiRequest<JobDetail>(`${one(id)}/jobs/${jobId}/dispute`, { method: "POST", ...json({ note }) }),
    confirm: (id: number, jobId: number, allowDuplicate = false) =>
      apiRequest<JobDetail>(`${one(id)}/jobs/${jobId}/confirm${allowDuplicate ? "?allow_duplicate=true" : ""}`, { method: "POST" }),
    suggestions: (id: number, jobId: number) => apiRequest<{ items: Suggestion[] }>(`${one(id)}/jobs/${jobId}/suggestions`),
    reopen: (id: number, jobId: number) => apiRequest<JobDetail>(`${one(id)}/jobs/${jobId}/reopen`, { method: "POST" }),
    remove: (id: number, jobId: number) => apiRequest<{ ok: true }>(`${one(id)}/jobs/${jobId}`, { method: "DELETE" }),
    plan: (id: number, jobId: number) => apiRequest<PlanPreview>(`${one(id)}/jobs/${jobId}/plan`),
    setPlan: (
      id: number,
      jobId: number,
      mode: SplitMode,
      targets: { shop_id: number; party_id?: number | null; listing_id: number | null; variant?: string; qty: number; amount?: number | null; item_id?: number | null }[],
      remainderPartyId: number | null,
    ) => apiRequest<PlanPreview>(`${one(id)}/jobs/${jobId}/plan`, { method: "PUT", ...json({ mode, targets, remainder_party_id: remainderPartyId }) }),
  },
  /** Onaylanmış işin uygulanmamış ürün paylarının hepsini Finans'a birim maliyet olarak yazar. */
  packages: {
    list: (id: number) => apiRequest<{ items: PackageType[] }>(`${one(id)}/packages`),
    save: (id: number, packageId: number | null, body: { name: string; is_default: boolean; lines: PackageLineBody[] }) =>
      apiRequest<PackageType>(`${one(id)}/packages${packageId ? `/${packageId}` : ""}`, { method: packageId ? "PUT" : "POST", ...json(body) }),
    remove: (id: number, packageId: number) => apiRequest<{ ok: true }>(`${one(id)}/packages/${packageId}`, { method: "DELETE" }),
    /** Kaydedilmemiş tarifin örnek ebat (cm) için miktar ve maliyeti. */
    preview: (id: number, lines: PackageLineBody[], longCm: number, shortCm: number) =>
      apiRequest<PackagePreview>(`${one(id)}/packages/preview`, { method: "POST", ...json({ lines, long_cm: longCm, short_cm: shortCm }) }),
    /** Bu kaydın paket türlerinin ürün başına maliyetini Finans'a ambalaj bileşeni olarak yazar; `dryRun` yalnızca önizler. */
    apply: (id: number, dryRun: boolean) => apiRequest<{ items: PackageApplyRow[]; applied: number }>(`${one(id)}/packages/apply?dry_run=${dryRun}`, { method: "POST" }),
  },
  productPackages: {
    list: (id: number) => apiRequest<{ items: ProductPackageRow[] }>(`${one(id)}/product-packages`),
    set: (id: number, body: { shop_id: number; listing_id: number; variant: string; package_ids: number[]; none: boolean }) =>
      apiRequest<{ ok: true }>(`${one(id)}/product-packages`, { method: "PUT", ...json(body) }),
  },
  applyJobCosts: (id: number, jobId: number) => apiRequest<{ applied: number }>(`${one(id)}/jobs/${jobId}/apply-costs`, { method: "POST" }),
  /** İşin uygulanmış ürün maliyetlerini geri alır. */
  undoJobCosts: (id: number, jobId: number) => apiRequest<{ reverted: number }>(`${one(id)}/jobs/${jobId}/undo-costs`, { method: "POST" }),
  applyAllocation: (id: number, allocationId: number) =>
    apiRequest<{ unit_cost: number; currency: string }>(`${one(id)}/allocations/${allocationId}/apply`, { method: "POST" }),
  /** Dönem raporu; aralık null ise tüm zamanlar. */
  report: (id: number, range: { start: string; end: string } | null) => apiRequest<SupplyReport>(`${one(id)}/report${range ? `?start=${range.start}&end=${range.end}` : ""}`),
  analyze: {
    file: (id: number, file: File, opts: { createJob: boolean; jobId?: number | null; note?: string }) => {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("create_job", String(opts.createJob));
      if (opts.note) form.append("note", opts.note);
      if (opts.jobId) form.append("job_id", String(opts.jobId));
      return apiUpload<AnalyzeResult>(`${one(id)}/documents`, form);
    },
    text: (id: number, text: string, opts: { createJob: boolean; jobId?: number | null }) =>
      apiRequest<AnalyzeResult>(`${one(id)}/documents/text`, { method: "POST", ...json({ text, create_job: opts.createJob, job_id: opts.jobId ?? null }) }),
    again: (id: number, docId: number, createJob = false) =>
      apiRequest<AnalyzeResult>(`${one(id)}/documents/${docId}/analyze?create_job=${createJob}`, { method: "POST" }),
    jobFrom: (id: number, docId: number) => apiRequest<JobDetail & { existing: boolean }>(`${one(id)}/documents/${docId}/job`, { method: "POST" }),
  },
};

export const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.html,.htm,.txt";

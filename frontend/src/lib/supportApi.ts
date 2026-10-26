import { apiRequest, apiUpload } from "@/lib/api";

/** Destek talepleri (kullanıcı: /api/support, yönetici: /api/admin/tickets). Dosyalar çok parçalı (multipart) gider. */
export type TicketStatus = "open" | "waiting_user" | "resolved";
export type TicketCategory = "bug" | "question" | "feature" | "billing" | "other";

export type TicketAttachment = { id: number; filename: string; size: number; content_type: string };
export type TicketMessage = { id: number; author: "user" | "admin"; body: string; internal: boolean; created_at: string; attachments: TicketAttachment[] };
export type TicketSummary = { id: number; subject: string; category: TicketCategory; status: TicketStatus; user_unread: boolean; rating: 1 | -1 | null; created_at: string; updated_at: string };
export type TicketDetail = TicketSummary & { messages: TicketMessage[] };

export type TicketPriority = "low" | "normal" | "urgent";
export type TicketSource = "web" | "assistant" | "error";
export type AdminView = "open" | "mine" | "unassigned" | "unread" | "waiting" | "overdue" | "resolved" | "all";

export type TicketContext = {
  url?: string;
  referrer?: string;
  user_agent?: string;
  viewport?: string;
  theme?: string;
  lang?: string;
  shop?: string;
  app_version?: string;
  errors?: string[];
  /** Asistandan açılan talepte sohbetin son mesajları. */
  chat?: string[];
};
export type Person = { id: number; email: string; name: string | null };
export type AdminTicketSummary = TicketSummary & {
  user: Person;
  admin_unread: boolean;
  priority: TicketPriority;
  source: TicketSource;
  assignee: Person | null;
  /** Etiket anahtarları (adları `adminTicketsApi.options()` verir). */
  labels: string[];
};
/** Talebin iş kaydı satırı: `detail` türe göre değişir (durum, öncelik, atanan adı, etiket anahtarları, kaynak, puan). */
export type TicketEvent = { id: number; kind: "created" | "status" | "assignee" | "priority" | "labels" | "rating"; detail: string; actor: string | null; created_at: string };
export type AdminTicketDetail = AdminTicketSummary & {
  messages: TicketMessage[];
  context: TicketContext;
  /** Aynı hatayı bildiren diğer talepler ve o hatanın otomatik yakalanma sayısı. */
  similar: { id: number; subject: string; status: TicketStatus }[];
  error_count: number;
  events: TicketEvent[];
  suggested_labels: string[];
  first_response_at: string | null;
  resolved_at: string | null;
};
export type AdminTicketPage = { items: AdminTicketSummary[]; total: number; page: number; pages: number; counts: Record<AdminView, number> };
export type TicketLabelOption = { key: string; tr: string; en: string };
export type TicketOptions = { labels: TicketLabelOption[]; staff: Person[]; views: AdminView[]; priorities: TicketPriority[]; overdue_hours: number };
export type TicketPatch = { status?: TicketStatus; assignee_id?: number | null; priority?: TicketPriority; labels?: string[] };
export type TicketListQuery = { view: AdminView; q: string; label: string; priority: string; category: string; page: number };
export type TicketReport = {
  days: number;
  created: number;
  resolved: number;
  open_now: number;
  first_response_hours: number | null;
  resolution_hours: number | null;
  rating_up: number;
  rating_down: number;
  by_category: Record<string, number>;
  by_source: Record<string, number>;
  by_label: Record<string, number>;
  unlabelled: number;
};
export type CannedReply = { id: number; title: string; body: string };
export type ErrorGroupStatus = "open" | "resolved" | "ignored";
export type ErrorGroup = {
  id: number;
  source: "client" | "server";
  message: string;
  detail: string;
  url: string;
  status: ErrorGroupStatus;
  count: number;
  tickets: number;
  first_seen: string;
  last_seen: string;
};

function form(fields: Record<string, string | boolean>, files: File[]): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const f of files) fd.append("files", f, f.name);
  return fd;
}

export const supportApi = {
  list: () => apiRequest<TicketSummary[]>("/api/support/tickets"),
  unread: () => apiRequest<{ count: number }>("/api/support/unread"),
  get: (id: number) => apiRequest<TicketDetail>(`/api/support/tickets/${id}`),
  create: (f: { subject: string; category: TicketCategory; body: string; context: TicketContext }, files: File[]) =>
    apiUpload<{ id: number }>("/api/support/tickets", form({ subject: f.subject, category: f.category, body: f.body, context: JSON.stringify(f.context) }, files)),
  reply: (id: number, body: string, files: File[]) => apiUpload<TicketDetail>(`/api/support/tickets/${id}/messages`, form({ body }, files)),
  resolve: (id: number) => apiRequest<TicketDetail>(`/api/support/tickets/${id}/resolve`, { method: "POST" }),
  rate: (id: number, rating: 1 | -1) => apiRequest<TicketDetail>(`/api/support/tickets/${id}/rating`, { method: "POST", body: JSON.stringify({ rating }) }),
  attachmentUrl: (id: number) => apiRequest<{ url: string; filename: string }>(`/api/support/attachments/${id}/url`),
  /** Tarayıcının yakaladığı arayüz hatasını sessizce bildirir (bkz. lib/clientErrors.ts). */
  reportError: (body: { message: string; detail: string; url: string }) => apiRequest<void>("/api/support/errors", { method: "POST", body: JSON.stringify(body) }),
};

export const adminTicketsApi = {
  list: (q: TicketListQuery) =>
    apiRequest<AdminTicketPage>(`/api/admin/tickets?${new URLSearchParams({ view: q.view, q: q.q, label: q.label, priority: q.priority, category: q.category, page: String(q.page) })}`),
  options: () => apiRequest<TicketOptions>("/api/admin/tickets/options"),
  report: (days: number) => apiRequest<TicketReport>(`/api/admin/tickets/report?days=${days}`),
  get: (id: number) => apiRequest<AdminTicketDetail>(`/api/admin/tickets/${id}`),
  reply: (id: number, body: string, opts: { internal: boolean; resolve: boolean }, files: File[]) =>
    apiUpload<AdminTicketDetail>(`/api/admin/tickets/${id}/messages`, form({ body, internal: opts.internal, resolve: opts.resolve }, files)),
  update: (id: number, patch: TicketPatch) => apiRequest<AdminTicketDetail>(`/api/admin/tickets/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  bulk: (ids: number[], changes: TicketPatch) => apiRequest<{ updated: number }>("/api/admin/tickets/bulk", { method: "POST", body: JSON.stringify({ ids, changes }) }),
  resolveGroup: (id: number) => apiRequest<AdminTicketDetail>(`/api/admin/tickets/${id}/resolve-group`, { method: "POST" }),
  attachmentUrl: (id: number) => apiRequest<{ url: string; filename: string }>(`/api/admin/tickets/attachments/${id}/url`),
  canned: () => apiRequest<CannedReply[]>("/api/admin/tickets/canned"),
  saveCanned: (id: number | null, body: { title: string; body: string }) =>
    apiRequest<CannedReply>(id ? `/api/admin/tickets/canned/${id}` : "/api/admin/tickets/canned", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
  deleteCanned: (id: number) => apiRequest<void>(`/api/admin/tickets/canned/${id}`, { method: "DELETE" }),
  errors: (status: "open" | "all") => apiRequest<ErrorGroup[]>(`/api/admin/errors?status=${status}`),
  setErrorStatus: (id: number, status: ErrorGroupStatus) => apiRequest<void>(`/api/admin/errors/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
};

import { apiRequest, apiUpload } from "@/lib/api";

/** Destek talepleri (kullanıcı: /api/support, yönetici: /api/admin/tickets). Dosyalar çok parçalı (multipart) gider. */
export type TicketStatus = "open" | "waiting_user" | "resolved";
export type TicketCategory = "bug" | "question" | "feature" | "billing" | "other";

export type TicketAttachment = { id: number; filename: string; size: number; content_type: string };
export type TicketMessage = { id: number; author: "user" | "admin"; body: string; internal: boolean; created_at: string; attachments: TicketAttachment[] };
export type TicketSummary = { id: number; subject: string; category: TicketCategory; status: TicketStatus; user_unread: boolean; rating: 1 | -1 | null; created_at: string; updated_at: string };
export type TicketDetail = TicketSummary & { messages: TicketMessage[] };

export type TicketContext = { url?: string; referrer?: string; user_agent?: string; viewport?: string; theme?: string; lang?: string; shop?: string; app_version?: string; errors?: string[] };
export type AdminTicketUser = { id: number; email: string; name: string | null };
export type AdminTicketSummary = TicketSummary & { user: AdminTicketUser; admin_unread: boolean };
export type AdminTicketDetail = TicketDetail & {
  user: AdminTicketUser;
  admin_unread: boolean;
  context: TicketContext;
  /** Aynı hatayı bildiren diğer talepler ve o hatanın otomatik yakalanma sayısı. */
  similar: { id: number; subject: string; status: TicketStatus }[];
  error_count: number;
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
  list: (status: "open" | "resolved" | "all", q: string) => apiRequest<AdminTicketSummary[]>(`/api/admin/tickets?${new URLSearchParams({ status, q })}`),
  get: (id: number) => apiRequest<AdminTicketDetail>(`/api/admin/tickets/${id}`),
  reply: (id: number, body: string, opts: { internal: boolean; resolve: boolean }, files: File[]) =>
    apiUpload<AdminTicketDetail>(`/api/admin/tickets/${id}/messages`, form({ body, internal: opts.internal, resolve: opts.resolve }, files)),
  setStatus: (id: number, status: TicketStatus) => apiRequest<AdminTicketDetail>(`/api/admin/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  resolveGroup: (id: number) => apiRequest<AdminTicketDetail>(`/api/admin/tickets/${id}/resolve-group`, { method: "POST" }),
  attachmentUrl: (id: number) => apiRequest<{ url: string; filename: string }>(`/api/admin/tickets/attachments/${id}/url`),
  canned: () => apiRequest<CannedReply[]>("/api/admin/tickets/canned"),
  saveCanned: (id: number | null, body: { title: string; body: string }) =>
    apiRequest<CannedReply>(id ? `/api/admin/tickets/canned/${id}` : "/api/admin/tickets/canned", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
  deleteCanned: (id: number) => apiRequest<void>(`/api/admin/tickets/canned/${id}`, { method: "DELETE" }),
  errors: (status: "open" | "all") => apiRequest<ErrorGroup[]>(`/api/admin/errors?status=${status}`),
  setErrorStatus: (id: number, status: ErrorGroupStatus) => apiRequest<void>(`/api/admin/errors/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
};

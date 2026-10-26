import { apiRequest, type MediaState } from "@/lib/api";

/** Çoklu medya üretimi (backend assistant/router.py media-jobs): durum, [Üret] ile başlatma, durdurma. Üretimi ve kredi harcamasını yalnızca `start` (kullanıcının düğmesi) başlatır. */
const url = (shopId: number, jobId: string, action?: "start" | "stop") => `/api/shops/${shopId}/assistant/media-jobs/${jobId}${action ? `/${action}` : ""}`;

export const mediaApi = {
  job: (shopId: number, jobId: string) => apiRequest<MediaState>(url(shopId, jobId)),
  start: (shopId: number, jobId: string) => apiRequest<MediaState>(url(shopId, jobId, "start"), { method: "POST" }),
  stop: (shopId: number, jobId: string) => apiRequest<MediaState>(url(shopId, jobId, "stop"), { method: "POST" }),
};

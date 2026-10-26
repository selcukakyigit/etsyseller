import { API_URL, apiRequest, type BatchEdit, type BatchState } from "@/lib/api";

/** Toplu taslak oluşturma işi (backend assistant/router.py batch-jobs): durum sorgusu, ön kontrolü onaylama, durdurma. */
const base = (shopId: number, jobId: string) => `/api/shops/${shopId}/assistant/batch-jobs/${jobId}`;

export const batchApi = {
  job: (shopId: number, jobId: string, action?: "stop") => apiRequest<BatchState>(`${base(shopId, jobId)}${action ? `/${action}` : ""}`, { method: action ? "POST" : "GET" }),
  /** Ön kontrolü onaylar; yalnızca kullanıcının değiştirdiği alanlar gönderilir. */
  start: (shopId: number, jobId: string, items: BatchEdit[]) => apiRequest<BatchState>(`${base(shopId, jobId)}/start`, { method: "POST", body: JSON.stringify({ items }) }),
  /** Yüklenen ürün resminin adresi (sohbet resmi; çerez ile yetkilendirilir). */
  imageSrc: (shopId: number, imageId: string) => `${API_URL}/api/shops/${shopId}/assistant/images/${imageId}`,
};

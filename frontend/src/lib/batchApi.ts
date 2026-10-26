import { apiRequest, type BatchState } from "@/lib/api";

/** Toplu taslak oluşturma işi (backend assistant/router.py batch-jobs): durum sorgusu ve durdurma. */
export const batchApi = {
  job: (shopId: number, jobId: string, action?: "stop") =>
    apiRequest<BatchState>(`/api/shops/${shopId}/assistant/batch-jobs/${jobId}${action ? `/${action}` : ""}`, { method: action ? "POST" : "GET" }),
};

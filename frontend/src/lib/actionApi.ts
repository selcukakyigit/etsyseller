import { apiRequest, type ActionState } from "@/lib/api";

/** Düğmeli onay (backend assistant/actions.py): geri dönüşü zor işi model değil kullanıcının tıklaması çalıştırır. */
const url = (shopId: number, actionId: string, verb: "confirm" | "cancel") => `/api/shops/${shopId}/assistant/actions/${actionId}/${verb}`;

export const actionApi = {
  confirm: (shopId: number, actionId: string) => apiRequest<ActionState>(url(shopId, actionId, "confirm"), { method: "POST" }),
  cancel: (shopId: number, actionId: string) => apiRequest<ActionState>(url(shopId, actionId, "cancel"), { method: "POST" }),
};

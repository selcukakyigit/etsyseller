import { apiRequest, type ChatCard } from "@/lib/api";

/** Taslak kartındaki fiyat kutuları (backend assistant/router.py `/listings/{id}/prices`): asistanın edit_inventory işleviyle aynı yere yazar, model çağrılmaz; güncel kartı döner. */
export const priceApi = {
  set: (shopId: number, listingId: number, body: { variation: string | null; prices: { option: string | null; price: number }[] }) =>
    apiRequest<Extract<ChatCard, { type: "listing_draft" }>>(`/api/shops/${shopId}/assistant/listings/${listingId}/prices`, { method: "POST", body: JSON.stringify(body) }),
};

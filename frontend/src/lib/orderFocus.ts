/**
 * Bildirimden siparişe geçiş: `/orders?tab=…&receipt=…` adresi o siparişi bulup vurgular. Sipariş sayfası zaten açıksa
 * Next aynı sayfayı yeniden kurmaz; bu yüzden tıklamada ayrıca bir olay yayınlanır ve açık sayfa onu dinler.
 */
import type { AppNotification } from "@/lib/api";

export type OrderFocus = { receipt?: number; tab?: string; shipBy?: string };

export const ORDER_FOCUS_EVENT = "ulagg:order-focus";

const TAB_BY_KIND: Record<AppNotification["kind"], string> = {
  order_paid: "toship",
  order_shipped: "completed",
  order_delivered: "completed",
  order_canceled: "canceled",
};

export function focusForNotification(n: AppNotification): OrderFocus {
  return n.receipt_id ? { receipt: n.receipt_id, tab: TAB_BY_KIND[n.kind] } : {};
}

export function orderFocusHref(f: OrderFocus): string {
  const p = new URLSearchParams();
  if (f.tab && f.tab !== "toship") p.set("tab", f.tab);
  if (f.receipt) p.set("receipt", String(f.receipt));
  if (f.shipBy) p.set("shipby", f.shipBy);
  const qs = p.toString();
  return qs ? `/orders?${qs}` : "/orders";
}

export function emitOrderFocus(f: OrderFocus) {
  window.dispatchEvent(new CustomEvent<OrderFocus>(ORDER_FOCUS_EVENT, { detail: f }));
}

/** Adresteki odak (sayfa ilk açıldığında). */
export function orderFocusFromUrl(): OrderFocus {
  const p = new URLSearchParams(window.location.search);
  const receipt = Number(p.get("receipt"));
  return { receipt: receipt > 0 ? receipt : undefined, tab: p.get("tab") ?? undefined, shipBy: p.get("shipby") ?? undefined };
}

import { Order } from "@/lib/api";

export type Tab = "toship" | "completed" | "canceled" | "all";

export type OrderFilters = {
  shipBy: "all" | "overdue" | "today" | "tomorrow" | "week" | "none";
  destination: string; // ISO ülke kodu, "" = hepsi
  channel: "all" | "etsy" | "pattern";
  note: boolean;
  gift: boolean;
  personalized: boolean;
  upgrade: boolean;
};

export const EMPTY_ORDER_FILTERS: OrderFilters = {
  shipBy: "all",
  destination: "",
  channel: "all",
  note: false,
  gift: false,
  personalized: false,
  upgrade: false,
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const DAY = 86_400_000;

export type ShipBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

/** Gönderim tarihine göre kova (yalnızca gönderilmemiş siparişler için anlamlı). */
export function shipBucket(o: Order, now = new Date()): ShipBucket {
  if (!o.expected_ship_date) return "none";
  const diff = Math.round((startOfDay(new Date(o.expected_ship_date)).getTime() - startOfDay(now).getTime()) / DAY);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return "week";
  return "later";
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : "";

export function shipByLabel(o: Order): string {
  switch (shipBucket(o)) {
    case "overdue":
      return `Gecikmiş · ${fmtDate(o.expected_ship_date)}`;
    case "today":
      return "Bugün gönder";
    case "tomorrow":
      return "Yarın gönder";
    case "none":
      return "Tahmini tarih yok";
    default:
      return `${fmtDate(o.expected_ship_date)} tarihine kadar gönder`;
  }
}

export function tabOf(o: Order): Exclude<Tab, "all"> {
  if (o.is_canceled) return "canceled";
  return o.is_shipped ? "completed" : "toship";
}

export function applyOrderFilters(orders: Order[], f: OrderFilters, query: string): Order[] {
  const q = query.trim().toLowerCase();
  return orders.filter((o) => {
    if (f.shipBy !== "all") {
      const b = shipBucket(o);
      const ok = f.shipBy === "week" ? b === "today" || b === "tomorrow" || b === "week" : b === f.shipBy;
      if (!ok) return false;
    }
    if (f.destination && o.address.country_iso !== f.destination) return false;
    if (f.channel !== "all" && o.channel !== f.channel) return false;
    if (f.note && !o.buyer_note) return false;
    if (f.gift && !o.is_gift) return false;
    if (f.personalized && !o.has_personalization) return false;
    if (f.upgrade && !o.shipping_upgrade) return false;
    if (q) {
      const hay = [
        o.buyer_name,
        String(o.receipt_id),
        o.address.city,
        ...o.items.flatMap((i) => [i.title, i.sku ?? "", ...(i.variations ?? []).map((v) => v.value)]),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const amountOf = (total: string) => parseFloat(total) || 0;

export function sortOrders(orders: Order[], sort: string): Order[] {
  const far = Number.MAX_SAFE_INTEGER;
  const shipTs = (o: Order) => (o.expected_ship_date ? new Date(o.expected_ship_date).getTime() : far);
  const cmp: Record<string, (a: Order, b: Order) => number> = {
    shipby: (a, b) => shipTs(a) - shipTs(b) || +new Date(b.created_at) - +new Date(a.created_at),
    newest: (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
    oldest: (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
    total: (a, b) => amountOf(b.total) - amountOf(a.total),
  };
  return [...orders].sort(cmp[sort] ?? cmp.shipby);
}

export type Group = { key: string; label: string; orders: Order[] };

/** "Yarın gönder / 23 Eylül'e kadar gönder" gibi gruplar (Etsy Shop Manager'daki başlıklar). */
export function groupByShipBy(orders: Order[]): Group[] {
  const map = new Map<string, Group>();
  const order: string[] = [];
  for (const o of orders) {
    const b = shipBucket(o);
    const key = b === "later" || b === "week" ? `d:${o.expected_ship_date?.slice(0, 10)}` : b;
    if (!map.has(key)) {
      const label =
        b === "overdue" ? "Gecikmiş" : b === "today" ? "Bugün gönder" : b === "tomorrow" ? "Yarın gönder" : b === "none" ? "Tahmini tarih yok" : `${fmtDate(o.expected_ship_date)} tarihine kadar gönder`;
      map.set(key, { key, label, orders: [] });
      order.push(key);
    }
    map.get(key)!.orders.push(o);
  }
  return order.map((k) => map.get(k)!);
}

export function addressText(o: Order): string {
  if (o.address.formatted) return o.address.formatted;
  const a = o.address;
  return [a.name, a.first_line, a.second_line, [a.zip, a.city].filter(Boolean).join(" "), a.state, a.country_iso].filter(Boolean).join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

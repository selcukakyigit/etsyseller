import { Order } from "@/lib/api";
import { addressText } from "./orderUtils";

export type PrintOptions = {
  packingSlips: boolean;
  orderReceipts: boolean;
  shopName: boolean; // üstte mağaza adı
  buyerNotes: boolean;
  listingPhotos: boolean;
  costBreakdown: boolean; // hediye siparişlerde paket fişine hiç konmaz
  personalNote: string; // paket fişinin altına kısa not (boşsa yok)
};

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  packingSlips: true,
  orderReceipts: true,
  shopName: false,
  buyerNotes: true,
  listingPhotos: false,
  costBreakdown: true,
  personalNote: "",
};

type T = (tr: string, en: string) => string;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lines = (s: string) => esc(s).replace(/\n/g, "<br>");

function items(o: Order, photos: boolean): string {
  return o.items
    .map((it) => {
      const vars = (it.variations ?? []).map((v) => `<div class="v">${esc(v.name)}: <b>${esc(v.value)}</b></div>`).join("");
      const img = photos && it.image_url ? `<img src="${esc(it.image_url)}" alt="">` : "";
      return `<tr><td class="q">${it.quantity}×</td><td>${img}<div class="t">${esc(it.title)}</div>${it.sku ? `<div class="v">SKU ${esc(it.sku)}</div>` : ""}${vars}</td></tr>`;
    })
    .join("");
}

function costs(o: Order, t: T): string {
  const row = (label: string, value: string | null, bold = false) => (value ? `<tr class="${bold ? "b" : ""}"><td>${label}</td><td class="r">${esc(value)}</td></tr>` : "");
  return `<table class="c">${row(t("Ara toplam", "Subtotal"), o.subtotal)}${row(t("Kargo", "Shipping"), o.shipping_cost)}${row(t("Vergi", "Tax"), o.tax)}${row(t("Kupon", "Coupon"), o.coupon ? `−${o.coupon}` : null)}${row(t("Toplam", "Total"), o.total, true)}</table>`;
}

function page(o: Order, kind: "slip" | "receipt", opt: PrintOptions, shop: string, t: T): string {
  const gift = o.is_gift;
  const head = kind === "slip" ? t("Paket fişi", "Packing slip") : t("Sipariş fişi", "Order receipt");
  const note = opt.buyerNotes && o.buyer_note ? `<div class="n"><b>${t("Alıcı notu", "Note from buyer")}:</b> ${lines(o.buyer_note)}</div>` : "";
  const giftMsg = gift && o.gift_message ? `<div class="n g"><b>${t("Hediye mesajı", "Gift message")}:</b> ${lines(o.gift_message)}</div>` : "";
  // Hediye siparişlerin paket fişinde fiyat bilgisi yer almaz (alıcıya gidecek belge).
  const showCosts = opt.costBreakdown && (kind === "receipt" || !gift);
  return `<section>
    ${opt.shopName && shop ? `<div class="shop">${esc(shop)}</div>` : ""}
    <h1>${head} <small>#${o.receipt_id}</small></h1>
    <div class="grid"><div><h2>${t("Teslimat adresi", "Ship to")}</h2>${lines(addressText(o))}</div>
    <div><h2>${t("Sipariş", "Order")}</h2>${esc(new Date(o.created_at).toLocaleDateString())}<br>${esc(o.shipping_method ?? "")}${gift ? `<br>🎁 ${t("Hediye", "Gift")}` : ""}</div></div>
    <table class="i">${items(o, opt.listingPhotos)}</table>
    ${note}${giftMsg}${showCosts ? costs(o, t) : ""}
    ${kind === "slip" && opt.personalNote.trim() ? `<div class="p">${lines(opt.personalNote.trim())}</div>` : ""}
  </section>`;
}

export function printDocument(orders: Order[], opt: PrintOptions, shop: string, t: T): string {
  const pages = orders.flatMap((o) => [
    ...(opt.packingSlips ? [page(o, "slip", opt, shop, t)] : []),
    ...(opt.orderReceipts ? [page(o, "receipt", opt, shop, t)] : []),
  ]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${t("Siparişler", "Orders")}</title><style>
    @page{margin:14mm}body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:0}section{page-break-after:always;padding:2px}section:last-child{page-break-after:auto}
    h1{font-size:20px;margin:0 0 10px}h1 small{color:#666;font-weight:400}h2{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin:0 0 4px}
    .shop{font-weight:700;font-size:15px;margin-bottom:6px}.grid{display:flex;gap:40px;margin-bottom:14px}.grid>div{flex:1}
    table{border-collapse:collapse;width:100%}.i td{padding:8px 0;border-top:1px solid #ddd;vertical-align:top}.q{width:36px;font-weight:700}.t{font-weight:600}.v{color:#444;font-size:12px}
    img{float:left;width:64px;height:64px;object-fit:cover;margin-right:10px;border-radius:4px}.n{margin-top:12px;padding:8px;border:1px solid #ddd;border-radius:6px}.g{background:#fdf2f8}
    .c{width:260px;margin:14px 0 0 auto}.c td{padding:3px 0}.r{text-align:right}.b td{font-weight:700;border-top:1px solid #111}.p{margin-top:18px;padding-top:10px;border-top:1px dashed #aaa}
  </style></head><body>${pages.join("")}</body></html>`;
}

/** Gizli bir iframe'e yazıp tarayıcının yazdırma penceresini açar (hediye kartı yazdırmayla aynı yöntem). */
export function printOrders(orders: Order[], opt: PrintOptions, shop: string, t: T): void {
  if (orders.length === 0 || (!opt.packingSlips && !opt.orderReceipts)) return;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(printDocument(orders, opt, shop, t));
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 250);
}

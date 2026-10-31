// Fiyat bölümü: iki dilde, tam sayfa ve kısa (ana sayfa) hâliyle çizilir; indirim, özel miktar, sık sorulanlar ve yasal bağlantılar doğru görünür.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/pricing", pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { Pricing } = await import("../../src/components/site/landing/PricingSection.tsx");
const { COPY } = await import("../../src/components/site/landing/copy.ts");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const pack = (id, name, credits, price, list, pct) => ({ id, name_tr: name, name_en: name, credits, price_cents: price, currency: "USD", list_price_cents: list, discount_pct: pct });
const pricing = {
  enabled: true,
  welcome_credits: 100,
  packs: [pack(1, "Start", 1000, 999, 999, 0), pack(2, "Popular", 2750, 2499, 2748, 9), pack(3, "Power", 6000, 4999, 5994, 17)],
  custom: { min: 100, max: 100000, tiers: [{ from_credits: 2750, discount_pct: 9 }, { from_credits: 6000, discount_pct: 17 }] },
  actions: [{ key: "seo", kind: "text", label_tr: "SEO önerisi", label_en: "SEO suggestion", credits: 3 }, { key: "image:1k", kind: "image", label_tr: "Görsel · 1K", label_en: "Image · 1K", credits: 8 }],
};
const render = (lang, standalone, data = pricing) => renderToStaticMarkup(h(Pricing, { lang, c: COPY[lang], pricing: data, standalone }));

// 1) İngilizce, tam sayfa
let html = render("en", true);
for (const needle of ["Pay only for what you use.", "Start free with 100 credits", "$9.99", "$24.99", "$27.48", "9% off", "17% off", "Most popular", "per 1,000 credits", "Need a different amount?", "2,750+ credits: 9% off", "What costs how many credits", "How credits work", "Is there a subscription?", "/refunds", "/distance-sales", "/login?mode=register"]) {
  if (!html.includes(needle)) throw new Error(`EN tam sayfada yok: ${needle}`);
}
eq(html.includes("{min}") || html.includes("{pct}") || html.includes("{from}"), false, "yer tutucu açıkta kalmamalı");
console.log("1 EN tam sayfa OK");

// 2) Türkçe, tam sayfa
html = render("tr", true);
for (const needle of ["Yalnızca kullandığın kadar öde.", "%9 indirim", "En popüler", "1.000 kredi başına", "Farklı bir miktar mı lazım?", "2.750+ kredi: %9 indirim", "Abonelik var mı?", "Mesafeli Satış Sözleşmesi"]) {
  if (!html.includes(needle)) throw new Error(`TR tam sayfada yok: ${needle}`);
}
console.log("2 TR tam sayfa OK");

// 3) Ana sayfa (kısa): paketler var, hesaplayıcı/SSS yok, "tüm ayrıntılar" bağlantısı var
html = render("en", false);
eq(html.includes("$24.99") && html.includes("See all pricing details") && html.includes('href="/pricing"'), true, "kısa hâl paketleri ve bağlantıyı gösterir");
eq(html.includes("Is there a subscription?") || html.includes("Need a different amount?"), false, "kısa hâlde SSS ve hesaplayıcı yok");
console.log("3 kısa hâl OK");

// 4) Paket yoksa "yakında" kartı; özel miktar bölümü çizilmez
html = render("en", true, { enabled: false, welcome_credits: 100, packs: [], custom: null, actions: [] });
eq(html.includes("Credit packs are coming soon") && !html.includes("Need a different amount?"), true, "paketsiz hâl");
console.log("4 paketsiz hâl OK");

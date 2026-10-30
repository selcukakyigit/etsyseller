import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/discover", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: CountryPanel } = await import("../../src/components/discover/home/CountryPanel.tsx");
const { default: SeasonCalendar } = await import("../../src/components/discover/home/SeasonCalendar.tsx");
const { default: Movers } = await import("../../src/components/discover/home/Movers.tsx");
const { default: Opportunities } = await import("../../src/components/discover/home/Opportunities.tsx");
const { default: PulseCards } = await import("../../src/components/discover/home/PulseCards.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
async function mount(node) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(node));
  await act(async () => { await sleep(60); }); // harita yolları gevşek yüklenir
  return { host, text: () => host.textContent, root };
}
const countries = (extra = {}) => ({ enabled: true, default_market: "US", tags: 5, rows: [], preparing: false, ...extra });
const customers = (rows = []) => ({ days: 365, orders: rows.reduce((n, r) => n + r.orders, 0), rows });
const noop = () => {};

// 1) hiç veri yok: açıklayıcı boş durumlar, çökme yok
let m = await mount(h(CountryPanel, { countries: countries(), customers: customers(), onPick: noop }));
eq(m.text().includes("Ülke verisi henüz hazır değil"), true, "arama verisi yokken açıklama");
eq(m.host.querySelectorAll("svg[role=group] path[aria-label]").length, 0, "veri yokken etkileşimli ülke yok");
await act(async () => click([...m.host.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === "Müşterilerin")));
eq(m.text().includes("Son bir yılda sipariş yok."), true, "siparişsiz mağaza için açıklama");
console.log("1 boş durumlar OK");

// 2) arama verisi yok ama siparişler var: görünüm kendiliğinden müşterilere döner; bilinmeyen ülke kodu sayfayı düşürmez
await act(async () => m.root.unmount()); m.host.remove();
m = await mount(h(CountryPanel, { countries: countries(), customers: customers([{ country: "US", orders: 5, share: 83 }, { country: "??", orders: 1, share: 17 }]), onPick: noop }));
eq(m.host.querySelector("button[aria-pressed=true]").textContent, "Müşterilerin", "arama verisi yoksa müşteri görünümüyle açılır");
eq(m.text().includes("??"), true, "bilinmeyen ülke kodu listede kodla görünür (countryName düşürmez)");
eq(m.host.querySelectorAll("svg[role=group] path[aria-label]").length, 1, "haritada yalnızca bilinen ülke etkileşimli");
console.log("2 müşteri görünümü ve bilinmeyen kod OK");

// 3) ülke ölçümü kapalı / hazırlanıyor notları; ülkenin en çok aranan etiketi tıklanınca araştırılır
await act(async () => m.root.unmount()); m.host.remove();
const rows = [{ market: "US", volume: 12000, measured: 5, top_term: "metal wall art", default: true, share: 100 }];
let picked = null;
m = await mount(h(CountryPanel, { countries: countries({ enabled: false, rows }), customers: customers(), onPick: (t) => { picked = t; } }));
eq(m.text().includes("Ülke ölçümü kapalı"), true, "kapalıyken yalnızca ana pazar notu");
await act(async () => click([...m.host.querySelectorAll("button")].find((b) => b.textContent.includes("metal wall art"))));
eq(picked, "metal wall art", "ülkenin en çok aranan etiketi tıklanınca araştırılır");
await act(async () => m.root.unmount()); m.host.remove();
m = await mount(h(CountryPanel, { countries: countries({ preparing: true, rows }), customers: customers(), onPick: noop }));
eq(m.text().includes("hazırlanıyor, haftalık güncellenir"), true, "diğer ülkeler hazırlanırken not");
await act(async () => m.root.unmount()); m.host.remove();
console.log("3 kapalı ve hazırlanıyor notları OK");

// 4) takvim, yükselenler, fırsatlar, özet kartlar: boş durumlar
m = await mount(h("div", null, h(SeasonCalendar, { rows: [], preparing: false, onPick: noop }), h(Movers, { movers: { rising: [], falling: [] }, onPick: noop }), h(Opportunities, { items: [], onPick: noop })));
eq(m.text().includes("Sezonluk etiket bulunamadı"), true, "boş takvim açıklaması");
eq(m.text().includes("Belirgin bir yükseliş yok.") && m.text().includes("Belirgin bir düşüş yok."), true, "boş yükselen/düşen açıklaması");
eq(m.text().includes("Şimdilik öneri yok"), true, "boş fırsat listesi açıklaması");
await act(async () => m.root.unmount()); m.host.remove();
m = await mount(h(SeasonCalendar, { rows: [], preparing: true, onPick: noop }));
eq(m.text().includes("sezonları hesaplanıyor"), true, "hazırlanırken takvim açıklaması");
await act(async () => m.root.unmount()); m.host.remove();

const emptyOverview = { pulse: { tags: 0, measured: 0, monthly_searches: 0, top_market: null, next_peak: null }, countries: countries() };
m = await mount(h(PulseCards, { overview: emptyOverview, onPick: noop }));
eq(m.text().includes("sezonluk etiket yok") && m.text().includes("ülke verisi hazırlanıyor"), true, "veri yokken özet kartlar çizgi ve açıklama gösterir");
eq(m.host.querySelectorAll("button").length, 0, "sıradaki sezon yoksa kart tıklanabilir değil");
await act(async () => m.root.unmount()); m.host.remove();
console.log("4 boş özet, takvim, yükselen, fırsat OK");

// 5) yükselen/düşen: işaret, sezonluk notu; fırsat tıklaması
const movers = { rising: [{ term: "a sign", volume: 1200, trend_pct: 80, monthly: [1, 2, 3, 4, 5, 6], last_month: "2026-10", seasonal: true }], falling: [{ term: "b sign", volume: 900, trend_pct: -35, monthly: [6, 5, 4, 3, 2, 1], last_month: "2026-10", seasonal: false }] };
m = await mount(h(Movers, { movers, onPick: (t) => { picked = t; } }));
eq(m.text().includes("+80%") && m.text().includes("-35%"), true, "yükselen artı, düşen eksi işaretiyle");
eq(m.text().includes("sezonluk"), true, "sezonluk etiket belirtilir");
await act(async () => click([...m.host.querySelectorAll("button")].find((b) => b.textContent.includes("b sign"))));
eq(picked, "b sign", "düşen kelimeye tıklayınca araştırılır");
await act(async () => m.root.unmount()); m.host.remove();
console.log("5 yükselen ve düşenler OK");

console.log("ANA EKRAN KARTLARI TESTLERİ GEÇTİ");

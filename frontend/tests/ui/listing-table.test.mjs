// Listing analiz tablosu: sıralama mantığı (verisiz satır hep altta, eşitlikte toplam satış), başlığa tıklama, kayıtlı sıralamanın çözülmesi ve gerçek bileşenin çizimi.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/listings", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { compareListings, nextSort, conversionPct, decodeSort, encodeSort, DEFAULT_TABLE_SORT, TABLE_SORT_VALUES } = await import("../../src/components/listings/tableSort.ts");
const { default: ListingTable } = await import("../../src/components/listings/ListingTable.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const L = (id, title, extra = {}) => ({ listing_id: id, title, tags: [], description: "", url: null, image_url: null, views: 100, favorites: 1, state: "active", quantity: 10, price_min: 20, price_max: 20, currency: "USD", skus: [], ...extra });
const sale = (month, total) => ({ this_month: month, last_month: 0, total, views_this: null, views_last: null, favs_this: null, favs_last: null });
const A = L(1, "Alpha sign", { views: 1000 }), B = L(2, "Bravo sign", { views: 400 }), C = L(3, "Charlie sign", { views: 50 }), D = L(4, "Delta sign", { views: 0 });
const sales = { 1: sale(2, 10), 2: sale(0, 10), 3: sale(5, 1) };  // Delta için satış verisi yok
const ranks = { 1: { keyword: "metal sign", position: 12, measured: "x", change_7d: 2, keywords: 1, title: "" }, 2: { keyword: "metal sign", position: 3, measured: "x", change_7d: 0, keywords: 1, title: "" }, 3: { keyword: "metal sign", position: null, measured: "x", change_7d: 0, keywords: 1, title: "" } };
const data = { sales, ranks, touchedAt: (l) => ({ 1: 300, 2: 100, 3: 200, 4: 0 })[l.listing_id] };
const order = (sort) => [A, B, C, D].slice().sort(compareListings(sort, data)).map((l) => l.title[0]);

// 1) Satış (toplam) azalan; eşit toplamda (Alpha=Bravo=10) bu ay satışı değil toplam eşit → başlık; verisiz Delta sonda
eq(order({ key: "sales_total", dir: "desc" }), ["A", "B", "C", "D"], "toplam satış azalan, verisiz sonda");
eq(order({ key: "sales_total", dir: "asc" }), ["C", "A", "B", "D"], "toplam satış artan: verisiz yine sonda");
console.log("1 satış sıralaması OK");

// 2) Sıra: küçük = iyi; sırasız (takipte ama ilk N dışı) ve takipsiz sonda
eq(order({ key: "rank", dir: "asc" }), ["B", "A", "C", "D"], "sıra artan, sırasızlar sonda");
eq(order({ key: "rank", dir: "desc" }), ["A", "B", "C", "D"], "sıra azalan: sırasızlar yine sonda");
console.log("2 sıra sıralaması OK");

// 3) Dönüşüm = toplam satış ÷ görüntülenme; görüntülenmesi 0 olanın dönüşümü yok
eq(conversionPct(1000, sale(2, 10)), 1, "10/1000 = %1");
eq(conversionPct(0, sale(2, 10)), null, "görüntülenme 0: dönüşüm yok");
eq(conversionPct(100, undefined), null, "satış verisi yok");
eq(order({ key: "conversion", dir: "desc" }), ["B", "C", "A", "D"], "dönüşüm azalan: Bravo %2.5, Charlie %2, Alpha %1, verisiz sonda");
console.log("3 dönüşüm OK");

// 4) Başlığa tıklama: aynı sütun yön değiştirir; yeni sütun kendi ilk yönüyle (metin/sıra/fiyat artan, sayılar azalan) başlar; kayıtlı değer bozuksa varsayılan
eq(nextSort({ key: "views", dir: "desc" }, "views"), { key: "views", dir: "asc" }, "aynı sütun: yön değişir");
eq(nextSort({ key: "views", dir: "asc" }, "rank"), { key: "rank", dir: "asc" }, "sıra sütunu artan başlar");
eq(nextSort({ key: "rank", dir: "asc" }, "sales_total"), { key: "sales_total", dir: "desc" }, "satış azalan başlar");
eq(decodeSort(encodeSort({ key: "price", dir: "asc" })), { key: "price", dir: "asc" }, "kaydet/oku");
eq(decodeSort("bozuk:değer"), DEFAULT_TABLE_SORT, "bozuk kayıt: varsayılan");
eq(TABLE_SORT_VALUES.includes("rank:asc") && TABLE_SORT_VALUES.length === 20, true, "izin verilen değerler");
console.log("4 başlık tıklama ve kayıt OK");

// 5) Gerçek bileşen: sütun başlıkları, satırlar, başlığa tıklayınca onSort, seçim ve işlem düğmeleri
const el = document.createElement("div");
document.body.appendChild(el);
const root = createRoot(el);
const sorts = [], selects = [], actions = [];
const rows = [A, B, C, D].map((l) => ({
  listing: l, selected: l.listing_id === 2, onSelectChange: (on) => selects.push([l.listing_id, on]), onAction: (a) => actions.push([l.listing_id, a]),
  publishing: false, sales: sales[l.listing_id], rank: ranks[l.listing_id], touchedAt: data.touchedAt(l),
}));
await act(async () => root.render(h(ListingTable, { rows, sort: { key: "sales_total", dir: "desc" }, onSort: (s) => sorts.push(s), rankMax: 200, allSelected: false, onToggleAll: () => {} })));
const text = el.textContent;
eq(["Listing", "Fiyat", "Stok", "Satış (bu ay)", "Satış (toplam)", "Görüntülenme", "Favori", "Dönüşüm", "Sıra", "Güncelleme"].every((c) => text.includes(c)), true, "sütun başlıkları");
eq(el.querySelectorAll("tbody tr").length, 4, "dört satır");
eq(el.querySelector("th[aria-sort=descending]")?.textContent.includes("Satış (toplam)"), true, "etkin sütun aria-sort");
const headBtn = (label) => [...el.querySelectorAll("th button")].find((b) => b.textContent.includes(label));
await act(async () => headBtn("Sıra").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(sorts, [{ key: "rank", dir: "asc" }], "Sıra başlığına tıklama");
const rowChecks = [...el.querySelectorAll("tbody input[type=checkbox]")];
eq(rowChecks.map((c) => c.checked), [false, true, false, false], "seçili satır");
await act(async () => rowChecks[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(selects, [[1, true]], "satır seçimi");
const preview = [...el.querySelectorAll("tbody button")].find((b) => b.textContent === "Önizle");
await act(async () => preview.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(actions, [[1, "preview"]], "önizle işlemi");
eq(text.includes("1%") && text.includes("2,5%") || text.includes("2.5%"), true, "dönüşüm yüzdesi çizilir");
console.log("5 bileşen çizimi OK");
console.log("LİSTİNG TABLOSU TESTLERİ GEÇTİ");

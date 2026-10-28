// Fiyatı eksik taslak kartının fiyat kutuları: "hepsi aynı" kısayolu, tüm kutular dolmadan düğme kapalı, İLK tıklamada istek gider ve güncel kart döner, tek kutu (varyasyonsuz), hata gösterilir.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/assistant", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: PriceBoxes } = await import("../../src/components/assistant/PriceBoxes.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const calls = [];
let script = [];
globalThis.__api = async (path, init) => { calls.push({ call: `${init?.method ?? "GET"} ${path}`, body: init?.body ? JSON.parse(init.body) : null }); const next = script.shift(); if (next instanceof Error) throw next; return next; };

const el = document.createElement("div");
document.body.appendChild(el);
const root = createRoot(el);
const setValue = async (input, value) => { await act(async () => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new w.Event("input", { bubbles: true })); }); };
const apply = () => [...el.querySelectorAll("button")].find((b) => b.textContent.includes("Fiyatı uygula"));
const inputs = () => [...el.querySelectorAll("input")];

// 1) iki boyut: hepsi aynı kutusu + her boyut için kutu; doldurulmadan düğme kapalı
let applied = null;
await act(async () => root.render(h(PriceBoxes, { shopId: 7, listingId: -5, form: { variation: "Size", options: ["S 83x55cm/33x22in", "M 103x67cm/41x26in"] }, onApplied: (c) => { applied = c; } })));
eq(inputs().length, 3, "hepsi aynı + iki boyut kutusu");
eq(apply().disabled, true, "boşken düğme kapalı");
await setValue(inputs()[1], "80");
eq(apply().disabled, true, "yalnız biri doluyken düğme kapalı");
await setValue(inputs()[2], "120");
eq(apply().disabled, false, "hepsi dolunca açık");

// 2) İLK tıklamada istek gider, güncel kart onApplied'a verilir
script = [{ type: "listing_draft", listing_id: -5, price: [80, 120], price_missing: false, problems: [] }];
await act(async () => apply().dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(calls.length, 1, "ilk tıklamada tek istek");
eq(calls[0], { call: "POST /api/shops/7/assistant/listings/-5/prices", body: { variation: "Size", prices: [{ option: "S 83x55cm/33x22in", price: 80 }, { option: "M 103x67cm/41x26in", price: 120 }] } }, "istek gövdesi");
eq(applied?.price, [80, 120], "güncel kart yukarıya verildi");

// 3) hepsi aynı kısayolu iki kutuyu birden doldurur
await act(async () => root.render(h(PriceBoxes, { shopId: 7, listingId: -6, form: { variation: "Size", options: ["S", "M"] }, onApplied: () => {} })));
await setValue(inputs()[0], "45");
eq(inputs().map((i) => i.value), ["45", "45", "45"], "hepsi aynı kutusu satırları doldurur");

// 4) varyasyonsuz: tek kutu, option null; sunucu hatası ekranda görünür
await act(async () => root.render(h(PriceBoxes, { shopId: 7, listingId: -7, form: { variation: null, options: [] }, onApplied: () => {} })));
eq(inputs().length, 1, "varyasyonsuzda tek kutu");
await setValue(inputs()[0], "30");
script = [Object.assign(new Error("Fiyat en az 0.2 olmalı."), {})];
await act(async () => apply().dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(calls[1].body, { variation: null, prices: [{ option: null, price: 30 }] }, "tek fiyat gövdesi");
eq(el.textContent.includes("Fiyat en az 0.2 olmalı."), true, "hata gösterilir");
console.log("FİYAT KUTULARI TESTİ GEÇTİ");
process.exit(0);

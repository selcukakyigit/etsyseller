import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/supply/1", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, sessionStorage: w.sessionStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.__toasts = [];
globalThis.__infos = [];

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: PriceBookTable } = await import("../../src/modules/components/PriceBookTable.tsx");
const { refreshMaterialCatalog } = await import("../../src/modules/core/materials.ts");

const catalog = {
  types: [{ key: "tape", tr: "Bant", en: "Tape", group: "film", builtin: true, density: null, used: 0 }],
  groups: {
    sheet: { units: ["sheet", "kg"], fields: {} },
    film: { units: ["piece", "kg", "g", "t", "mm", "cm", "m"], fields: { piece: ["roll_length", "roll_width", "film_um", "plate_kg"], kg: ["roll_width", "film_um"], m: [] } },
    piece: { units: ["piece", "sheet"], fields: {} },
    bulk: { units: ["kg", "piece"], fields: {} },
  },
  packs: [{ key: "pack", tr: "Paket", en: "Pack" }, { key: "roll", tr: "Rulo", en: "Roll" }, { key: "box", tr: "Koli", en: "Box" }],
};
const tape = { id: 22, kind: "material", name: "Koli bandı", unit: "m", spec: "", position: 0, archived: false, auto_qty: null, material: "tape", thickness_mm: null, plate_width: null, plate_height: null, plate_kg: null,
  roll_width: null, film_um: null, roll_length: null, group: "film", missing: [], by_length: false, track_stock: true, min_stock: null, entry_units: ["m"], on_hand: 0, avg_cost: 1, ref: 0, level: "out",
  price: 1, price_from: "2026-10-20T00:00:00Z", price_source: "owner", versions: 1 };
const calls = [];
const api = {
  base: "/api/supply",
  prices: {
    list: async () => ({ items: [tape] }),
    update: async (...a) => { calls.push(["update", a[1], a[2]]); return { ok: true }; },
    setPrice: async (...a) => { calls.push(["price", a[1], a[2]]); return { ok: true }; },
    stockHistory: async () => ({ items: [] }),
  },
  materialTypes: { list: async () => catalog },
};
await refreshMaterialCatalog(api, 1);
const access = { role: "member", permissions: [] };
const el = document.createElement("div");
document.body.appendChild(el);
const root = createRoot(el);
await act(async () => root.render(h(PriceBookTable, { api, entityId: 1, currency: "TRY", access })));
await act(async () => {});

const clickText = async (txt) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === txt); if (!b) throw new Error(`düğme yok: ${txt}`); await act(async () => b.click()); };
const setSelect = async (sel, value) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, "value").set; set.call(sel, value); sel.dispatchEvent(new w.Event("change", { bubbles: true })); }); };
const setInput = async (inp, value) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set; set.call(inp, value); inp.dispatchEvent(new w.Event("input", { bubbles: true })); }); };

// stok penceresinden: metre birimli rulo kalemi uyarı gösterir ve düğme düzenleme formunu açar
await clickText("Stok");
if (!document.body.textContent.includes("birimi metre")) throw new Error("metre birimli rulo kaleminde stok penceresi uyarı göstermeli");
await clickText("Kalemi düzenle");
if (document.body.textContent.includes("Stok: Koli bandı")) throw new Error("stok penceresi kapanmalı");
const unitSel = document.querySelector("select[aria-label='Birim']");
const eq = (x, y, m) => { if (JSON.stringify(x) !== JSON.stringify(y)) throw new Error(`${m}
  gelen: ${JSON.stringify(x)}
  beklenen: ${JSON.stringify(y)}`); };
if (!unitSel || ![...unitSel.options].some((o) => o.value === "piece")) throw new Error("rulo kaleminin birim listesinde adet olmalı");
const packSel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "Paketle almıyorum"));
if (!packSel || ![...packSel.options].some((o) => o.textContent === "Koli")) throw new Error("alış paketi listesinde Koli olmalı");
await setSelect(unitSel, "piece");
const label = (txt) => [...document.querySelectorAll("label")].find((l) => l.textContent.includes(txt));
await setInput(label("Rulo boyu").querySelector("input"), "100");
await setSelect(packSel, "box");
await setInput(label("Paketteki miktar").querySelector("input"), "80");
await clickText("Kaydet");
eq(calls, [["update", 22, { roll_length: 100, pack_size: 80, pack_unit: "box", unit: "piece" }]], "metre biriminden adet + rulo boyu + koli paketine tek kayıt");
eq(globalThis.__toasts, [], "hata bildirimi olmamalı");
console.log("BANT DÜZENLEME TESTİ GEÇTİ");

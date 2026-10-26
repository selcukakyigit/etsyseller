import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/supply", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { emptyStock, stockOf, stockPayload } = await import("../../src/modules/components/StockFields.tsx");
const { default: PackPriceNote, usePackPrice } = await import("../../src/modules/components/PackPrice.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };

// ---- 1) Paket alanları sunucuya giden değişikliğe çevrilir
const styro = { ...emptyStock, material: "styrofoam" };
eq(stockPayload({ ...styro, pack_size: "20" }), { material: "styrofoam", pack_size: 20, pack_unit: "pack" }, "miktar yazılıp tür seçilmezse paket sayılır");
eq(stockPayload({ ...styro, pack_unit: "roll", pack_size: "100" }), { material: "styrofoam", pack_size: 100, pack_unit: "roll" }, "seçilen tür gider");
eq(stockPayload(styro), { material: "styrofoam" }, "paket yoksa hiçbir paket alanı gitmez");
const saved = { ...styro, pack_unit: "roll", pack_size: "100" };
eq(stockPayload(saved, saved), {}, "değişmeyen paket gitmez");
eq(stockPayload({ ...saved, pack_unit: "box" }, saved), { pack_size: 100, pack_unit: "box" }, "yalnızca tür değişti");
eq(stockPayload({ ...saved, pack_size: "" }, saved), { pack_size: null, pack_unit: null }, "miktar silinince paket tamamen kalkar");
eq(stockPayload({ ...styro, pack_size: "-3" }), null, "geçersiz miktar reddedilir");
eq(stockOf({ material: "tape", pack_unit: "roll", pack_size: 100 }).pack_unit, "roll", "kayıtlı paket forma yüklenir");
console.log("1 paket alanları: gönderim, değişmeyen, silme, geçersiz OK");

// ---- 2) Fiyatı paket başına yazma: birim fiyata bölünür, geçişte yazılı sayı çevrilir
let api;
function Probe({ stock, startPrice }) {
  const [price, setPrice] = useState(startPrice);
  const pack = usePackPrice(stock, price, setPrice);
  api = { pack, price };
  return h("div", null, h(PackPriceNote, { pack, stock, unit: "sheet", price, currency: "TRY" }));
}
const mount = async (stock, startPrice) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(h(Probe, { stock, startPrice })));
  return { el, unmount: () => act(async () => { root.unmount(); el.remove(); }) };
};
let box = await mount({ ...styro, pack_size: "20" }, "20");
if (!box.el.textContent.includes("paket başına yaz") || !box.el.textContent.includes("/ paket")) throw new Error("paket miktarı varken anahtar ve karşılık görünmeli");
await act(async () => api.pack.toggle(true));
eq([api.pack.on, api.price, api.pack.toUnit(400)], [true, "400", 20], "paket fiyatına geçince sayı paket fiyatına çevrilir, kayıtta birim fiyata bölünür");
await act(async () => api.pack.toggle(false));
eq([api.pack.on, api.price], [false, "20"], "geri dönünce birim fiyata çevrilir");
await box.unmount();
box = await mount({ ...emptyStock, material: "tape", pack_unit: "roll", pack_size: "100" }, "0.8");
await act(async () => api.pack.toggle(true));
eq([api.price, api.pack.toUnit(80)], ["80", 0.8], "koli bandı: rulo 80 ₺ → metre 0,8 ₺");
await box.unmount();
box = await mount(styro, "20");
eq(box.el.textContent, "", "paket miktarı yoksa hiçbir şey çıkmaz");
eq(api.pack.toUnit(20), 20, "paketsiz fiyat olduğu gibi kalır");
await box.unmount();
console.log("2 paket fiyatı: çevirme ve bölme OK");
console.log("PAKET TESTLERİ GEÇTİ");

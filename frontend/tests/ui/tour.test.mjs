// Ürün turu: adımlar arasında gezinir, Esc/Atla kapatır, son adımda biter; örnek mağazada "Etsy'ye bağlan" çıkar; gerçek mağazalı kullanıcıya örnek veri metni gösterilmez.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ProductTour } = await import("../../src/components/tour/ProductTour.tsx");
const { mainTour, tourSeen, markTourSeen, MAIN_TOUR } = await import("../../src/components/tour/steps.ts");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const el = document.createElement("div");
document.body.appendChild(el);
let root = createRoot(el);
const text = () => el.textContent;
const button = (label) => [...el.querySelectorAll("button")].find((b) => b.textContent === label);
const click = (b) => act(async () => b.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
const key = (k) => act(async () => w.dispatchEvent(new w.KeyboardEvent("keydown", { key: k })));

// 1) İlk adım: sayaç, başlık, Geri yok
let closed = [];
const steps = mainTour(true);
await act(async () => root.render(h(ProductTour, { steps, onClose: (c) => closed.push(c) })));
eq(text().includes(`1 / ${steps.length}`), true, "sayaç");
eq(text().includes("Ulagg'a hoş geldin"), true, "ilk adım başlığı");
eq(button("Geri") === undefined, true, "ilk adımda Geri yok");
console.log("1 ilk adım OK");

// 2) İleri/Geri
await click(button("İleri"));
eq(text().includes(`2 / ${steps.length}`) && text().includes("Asistan"), true, "ikinci adım");
await click(button("Geri"));
eq(text().includes(`1 / ${steps.length}`), true, "geri dönüldü");
await key("ArrowRight");
eq(text().includes(`2 / ${steps.length}`), true, "ok tuşu ileri");
console.log("2 gezinme OK");

// 3) Esc kapatır ve tamamlanmadı der
await key("Escape");
eq(closed, [false], "Esc = tamamlanmadı");

// 4) Atla da aynı
await click(button("Turu atla"));
eq(closed, [false, false], "Atla = tamamlanmadı");
console.log("3 kapatma OK");

// 5) Son adım: örnek mağazada Etsy'ye bağlan + Örnekle devam et; kapanışta tamamlandı
await act(async () => root.unmount());
root = createRoot(el);
closed = [];
await act(async () => root.render(h(ProductTour, { steps, connectHref: "/connect", onClose: (c) => closed.push(c) })));
for (let i = 0; i < steps.length - 1; i++) await click(button("İleri"));
eq(text().includes(`${steps.length} / ${steps.length}`), true, "son adım");
const connect = [...el.querySelectorAll("a")].find((a) => a.textContent === "Etsy'ye bağlan");
eq(connect?.getAttribute("href"), "/connect", "bağlan bağlantısı");
await click(button("Örnekle devam et"));
eq(closed, [true], "son adımdan kapanış = tamamlandı");
console.log("4 son adım OK");

// 6) Gerçek mağazalı kullanıcı: örnek veri metni ve bağlan adımı yok
const real = mainTour(false);
eq(real.some((s) => s.id === "connect"), false, "bağlan adımı yok");
eq(real.length, MAIN_TOUR.length - 1, "bir adım eksik");
eq(JSON.stringify(real[0]).includes("örnek veri"), false, "gerçek mağazada 'örnek veri' denmez");
console.log("5 gerçek mağaza turu OK");

// 7) Görüldü kaydı
eq(tourSeen(7), false, "başta görülmedi");
markTourSeen(7);
eq(tourSeen(7), true, "işaretlendi");
eq(tourSeen(8), false, "başka kullanıcı etkilenmez");
console.log("6 görüldü kaydı OK");

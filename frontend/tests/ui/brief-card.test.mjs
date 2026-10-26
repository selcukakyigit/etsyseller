// Ön kontrol kartı: seçim + yazı birlikte gidince yazılan açıkça öncelikli işaretlenir; tek başına yazı olduğu gibi gider.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/assistant", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: BriefCard } = await import("../../src/components/assistant/BriefCard.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const card = { type: "brief", understood: [{ label: "Ürün", value: "Metal wall art" }], questions: [{ label: "Başlık seç", type: "title", options: ["Metal Wall Art A", "Metal Wall Art B", "Metal Wall Art C"] }] };
const el = document.createElement("div");
document.body.appendChild(el);
const sent = [];
const root = createRoot(el);
await act(async () => root.render(h(BriefCard, { card, onAsk: (m) => sent.push(m), active: true })));
const click = (b) => act(async () => b.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
const type = async (ta, value) => act(async () => {
  Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value").set.call(ta, value);
  ta.dispatchEvent(new w.Event("input", { bubbles: true }));
});
const create = () => [...el.querySelectorAll("button")].find((b) => /listeyi oluştur|create the listing/.test(b.textContent));

// 1) yalnızca yazı: olduğu gibi
await type(el.querySelector("textarea"), "abstract line art bubble metal wall decor gibi");
await click(create());
eq(sent[0], "abstract line art bubble metal wall decor gibi", "yalnızca yazı değişmeden gider");

// 2) seçim + yazı: yazılan öncelikli işaretlenir
await click([...el.querySelectorAll("button")].find((b) => b.textContent === "Metal Wall Art B"));
await click(create());
eq(sent[1].startsWith("Başlık seç: Metal Wall Art B\n"), true, "seçim ilk satırda");
eq(/BUNLAR geçerli|wins over/.test(sent[1]) && sent[1].endsWith("abstract line art bubble metal wall decor gibi"), true, "yazılan öncelikli işaretli");
// 3) tek soru + yalnızca seçim: mesaj yalnızca seçilen değer
await act(async () => root.unmount());
const el2 = document.createElement("div");
document.body.appendChild(el2);
const root2 = createRoot(el2);
const single = { type: "brief", understood: [], questions: [{ label: "Finish for outdoor use (powder coat or raw metal)?", type: "text", options: ["Powder coated", "Raw metal"] }] };
const sent2 = [];
await act(async () => root2.render(h(BriefCard, { card: single, onAsk: (m) => sent2.push(m), active: true })));
await click([...el2.querySelectorAll("button")].find((b) => b.textContent === "Powder coated"));
await click([...el2.querySelectorAll("button")].find((b) => /listeyi oluştur|create the listing/.test(b.textContent)));
eq(sent2, ["Powder coated"], "tek soruda mesaj yalnızca seçilen değer");
console.log("BRIEF KARTI TESTLERİ GEÇTİ");
process.exit(0);

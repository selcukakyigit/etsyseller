// Düğmeli onay kartı (taslak silme): basılana kadar hiçbir istek gitmez; Sil/Vazgeç sonucu gösterilir; süresi dolmuş istek anlaşılır mesaj verir.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/assistant", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: ConfirmActionCard } = await import("../../src/components/assistant/ConfirmActionCard.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const card = (status = "pending", result = {}) => ({ type: "confirm_action", action_id: "a1", kind: "delete_drafts", status, items: [{ listing_id: -1, title: "Insulated tumbler" }, { listing_id: -2, title: "Butterfly wall art" }], result });
const calls = [];
let script = [];
globalThis.__api = async (path, init) => { calls.push(`${init?.method ?? "GET"} ${path}`); const next = script.shift(); if (next instanceof Error) throw next; return next; };

const el = document.createElement("div");
document.body.appendChild(el);
let root = createRoot(el);
const text = () => el.textContent;
const button = (label) => [...el.querySelectorAll("button")].find((b) => b.textContent === label);
const click = (b) => act(async () => b.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));

// 1) Görüntülenince hiçbir istek gitmez; başlıklar ve düğmeler görünür
await act(async () => root.render(h(ConfirmActionCard, { card: card(), shopId: 7 })));
eq(calls.length, 0, "kart görünmekle silme olmaz");
eq(text().includes("Insulated tumbler") && text().includes("Butterfly wall art"), true, "silinecek taslakların başlıkları");
eq(text().includes("2 taslak silinecek"), true, "sayı özeti");
eq(button("Sil (2)") !== undefined && button("Vazgeç") !== undefined, true, "Sil ve Vazgeç düğmeleri");
console.log("1 kart yalnızca gösterir OK");

// 2) Sil: onay isteği gider, sonuç görünür, düğmeler kalkar
script = [card("done", { deleted: [-1, -2], skipped: [] })];
await click(button("Sil (2)"));
eq(calls, ["POST /api/shops/7/assistant/actions/a1/confirm"], "onay isteği");
eq(text().includes("2 taslak silindi"), true, "silindi özeti");
eq(button("Sil (2)") === undefined && button("Vazgeç") === undefined, true, "bitince düğme yok (ikinci tıklama olmaz)");
console.log("2 sil OK");

// 3) Vazgeç: iptal isteği gider
await act(async () => root.unmount());
calls.length = 0;
root = createRoot(el);
script = [card("cancelled")];
await act(async () => root.render(h(ConfirmActionCard, { card: card(), shopId: 7 })));
await click(button("Vazgeç"));
eq(calls, ["POST /api/shops/7/assistant/actions/a1/cancel"], "iptal isteği");
eq(text().includes("hiçbir şey silinmedi"), true, "vazgeçildi özeti");
console.log("3 vazgeç OK");

// 4) Süresi dolmuş / sunucu yeniden başlamış: anlaşılır mesaj
await act(async () => root.unmount());
root = createRoot(el);
script = [new Error("404")];
await act(async () => root.render(h(ConfirmActionCard, { card: card(), shopId: 7 })));
await click(button("Sil (2)"));
eq(text().includes("Onay isteği bulunamadı"), true, "kayıp onay mesajı");
console.log("4 süresi dolmuş OK");

console.log("ONAY KARTI TESTLERİ GEÇTİ");
process.exit(0);

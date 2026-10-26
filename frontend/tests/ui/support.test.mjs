import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/tickets", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, sessionStorage: w.sessionStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });
globalThis.URL.createObjectURL = () => "blob:preview";
globalThis.URL.revokeObjectURL = () => {};
globalThis.__toasts = [];

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: AdminTicketList } = await import("../../src/components/support/admin/AdminTicketList.tsx");
const { default: Composer } = await import("../../src/components/support/Composer.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const text = () => document.body.textContent;
const mount = async (node) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(node));
  return { el, root, unmount: () => act(async () => { root.unmount(); el.remove(); }) };
};

// ---- 1) Yönetici listesi: satırlar, numara, toplu işlem
const person = (id, email) => ({ id, email, name: null });
const ticket = (id, extra = {}) => ({
  id, subject: `Konu ${id}`, category: "bug", status: "open", user_unread: false, rating: null, created_at: "2026-10-26T08:00:00Z", updated_at: "2026-10-26T09:00:00Z",
  user: person(10 + id, `u${id}@x.co`), admin_unread: id === 1, priority: "normal", source: "web", assignee: null, labels: [], ...extra,
});
const options = { labels: [{ key: "photos", tr: "Fotoğraf", en: "Photos" }], staff: [person(1, "boss@x.co")], views: [], priorities: ["low", "normal", "urgent"], overdue_hours: 24 };
const page = { items: [ticket(1), ticket(2, { priority: "urgent", source: "assistant", labels: ["photos"], assignee: person(1, "boss@x.co") })], total: 2, page: 0, pages: 1, counts: {} };
const calls = [];
globalThis.__api = async (path, init) => { calls.push([path, init?.body]); return { updated: 2 }; };
let reloaded = 0;
const list = await mount(h(AdminTicketList, { data: page, error: null, loading: false, options, filters: { q: "", label: "", priority: "", category: "" }, activeId: null, onFilters() {}, onPage() {}, onBulkDone: () => { reloaded++; } }));
const t0 = text();
if (!t0.includes("#1 · Konu 1") || !t0.includes("#2 · Konu 2")) throw new Error("talep numaraları listede görünmeli");
if (!t0.includes("Acil") || !t0.includes("Asistan") || !t0.includes("# Fotoğraf") || !t0.includes("boss@x.co")) throw new Error("öncelik, kaynak, etiket ve atanan satırda görünmeli");
const boxes = () => [...document.querySelectorAll("input[type=checkbox]")];
await act(async () => boxes()[0].click());
await act(async () => boxes()[1].click());
if (!text().includes("2 seçili")) throw new Error("seçilince toplu işlem çubuğu çıkmalı");
const complete = [...document.querySelectorAll("button")].find((b) => b.textContent === "Tamamla");
await act(async () => complete.click());
eq(calls.map(([p, b]) => [p, JSON.parse(b)]), [["/api/admin/tickets/bulk", { ids: [1, 2], changes: { status: "resolved" } }]], "toplu tamamlama isteği");
eq(reloaded, 1, "toplu işlemden sonra liste yenilenmeli");
if (text().includes("seçili")) throw new Error("işlemden sonra seçim temizlenmeli");
await list.unmount();
console.log("1 yönetici listesi: numara, rozetler, toplu tamamlama OK");

// ---- 2) Yanıt kutusu: 5 dosya sınırı, yapıştırma, sayaç, Ctrl+Enter, taslak
const png = (n) => new w.File([new Uint8Array(8)], `a${n}.png`, { type: "image/png" });
const paste = (files) => {
  const ev = new w.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { files, getData: () => "" } });
  document.querySelector("textarea").dispatchEvent(ev);
};
const typeInto = async (value) => {
  const area = document.querySelector("textarea");
  const setter = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => { setter.call(area, value); area.dispatchEvent(new w.Event("input", { bubbles: true })); });
};
const sent = [];
const onSubmit = async (body, files) => { sent.push([body, files.map((f) => f.name)]); return true; };
const props = { placeholder: "Yaz", submitLabel: "Gönder", busy: false, onSubmit, draftKey: "support:test" };
let box = await mount(h(Composer, props));
await act(async () => paste(Array.from({ length: 7 }, (_, i) => png(i))));
eq(document.querySelectorAll("li").length, 5, "en fazla 5 ek tutulur");
if (!text().includes("5/5")) throw new Error("ek sayacı 5/5 göstermeli");
if (!__toasts.some((m) => m.includes("En fazla 5"))) throw new Error("sınır aşılınca uyarı verilmeli");
eq([...document.querySelectorAll("button")].find((b) => b.textContent.includes("Dosya"))?.disabled, true, "5 dosyada ekleme düğmesi kapanmalı");
await typeInto("Fotoğraf yüklenmiyor");
const area = document.querySelector("textarea");
await act(async () => area.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })));
eq(sent, [["Fotoğraf yüklenmiyor", ["a0.png", "a1.png", "a2.png", "a3.png", "a4.png"]]], "Ctrl+Enter metni ve dosyaları gönderir");
eq(document.querySelectorAll("li").length, 0, "gönderilince ekler temizlenir");
await typeInto("yarım kalan metin");
await box.unmount();
box = await mount(h(Composer, props));
eq(document.querySelector("textarea").value, "yarım kalan metin", "taslak, kutu kapanıp açılınca geri gelir");
await typeInto("");
await box.unmount();
console.log("2 yanıt kutusu: 5 dosya sınırı, yapıştırma, Ctrl+Enter, taslak OK");
console.log("DESTEK TESTLERİ GEÇTİ");

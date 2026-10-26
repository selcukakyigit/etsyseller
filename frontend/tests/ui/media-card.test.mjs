// Medya maliyet kartı: kart yalnızca gösterir (istek yok); [Üret] başlatır; bakiye yetmezse düğme kapalı/hata görünür; ilerleme ve sonuç; vazgeç/durdur.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/assistant", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: MediaJobCard } = await import("../../src/components/assistant/MediaJobCard.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quote = (extra = {}) => ({ per_image: 3, per_video: 10, images: 6, videos: 2, credits: 38, credits_enabled: true, balance: 100, affordable: true, ...extra });
const row = (id, extra = {}) => ({ listing_id: id, title: id === -1 ? "Insulated tumbler" : "Throw pillow", images: 5, video: true, credits: 25, skipped: [], state: "queued", images_done: 0, video_done: false, errors: [], ...extra });
const job = (status, items, extra = {}) => ({ job_id: "m1", status, quote: quote(), items, note: "", done: 0, failed: 0, running: 0, skipped: 0, seconds: 5, images_total: 0, videos_total: 0, ...extra });
const card = (extra = {}) => ({ type: "media_job", ...job("quote", [row(-1), row(-2, { images: 1, credits: 13, skipped: ["Fotoğraf sınırı dolu"] })], extra) });

const calls = [];
let script = [];
globalThis.__api = async (path, init) => { calls.push(`${init?.method ?? "GET"} ${path}`); const next = script.shift(); if (next instanceof Error) throw next; return next; };

const el = document.createElement("div");
document.body.appendChild(el);
let root = createRoot(el);
const text = () => el.textContent;
const button = (label) => [...el.querySelectorAll("button")].find((b) => b.textContent.startsWith(label));
const click = (b) => act(async () => b.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));

// 1) Maliyet kartı: yalnızca gösterir; hiçbir istek gitmez
await act(async () => root.render(h(MediaJobCard, { card: card(), shopId: 7 })));
eq(calls.length, 0, "kart görünmekle üretim ya da yoklama olmaz");
eq(text().includes("6 resim · 2 video") && text().includes("38 kredi"), true, "toplam resim/video ve kredi");
eq(text().includes("Bakiye: 100"), true, "bakiye görünür");
eq(text().includes("Fotoğraf sınırı dolu"), true, "sığmayan resim uyarısı");
eq(button("Üret (38 kredi)") !== undefined && button("Vazgeç") !== undefined, true, "[Üret] ve [Vazgeç]");
console.log("1 maliyet kartı yalnızca gösterir OK");

// 2) [Üret]: başlatma isteği; ilerleme yoklanır; bitince özet ve sonuç
script = [job("running", [row(-1, { state: "running" }), row(-2)]), job("done", [row(-1, { state: "done", images_done: 5, video_done: true }), row(-2, { state: "done", images_done: 1, images: 1, video_done: true })], { images_total: 6, videos_total: 2, done: 2 })];
await click(button("Üret (38 kredi)"));
eq(calls.find((c) => c.startsWith("POST")), "POST /api/shops/7/assistant/media-jobs/m1/start", "başlatma isteği");
eq(text().includes("Tamamlandı: 6 resim, 2 video"), true, "bitiş özeti (yoklamadan)");
eq(button("Durdur") === undefined && button("Üret (38 kredi)") === undefined, true, "biten işte düğme yok");
const polled = calls.length;
await act(async () => { await sleep(3200); });
eq(calls.length, polled, "bitince yoklama durur");
console.log("2 üret → ilerleme → sonuç OK");

// 3) Bakiye yetmiyor: düğme kapalı; sunucu 402 derse mesaj kartta kalır
await act(async () => root.unmount());
root = createRoot(el);
calls.length = 0;
await act(async () => root.render(h(MediaJobCard, { card: card({ quote: quote({ affordable: false, balance: 5 }) }), shopId: 7 })));
eq(text().includes("Bakiye yetmiyor"), true, "yetersiz bakiye uyarısı");
eq(button("Üret (38 kredi)").disabled, true, "bakiye yetmezken [Üret] kapalı");
await act(async () => root.unmount());
root = createRoot(el);
script = [new Error("Kredi yetersiz: bu iş 38 kredi tutuyor.")];
await act(async () => root.render(h(MediaJobCard, { card: card(), shopId: 7 })));
await click(button("Üret (38 kredi)"));
eq(text().includes("Kredi yetersiz: bu iş 38 kredi tutuyor."), true, "sunucunun hata mesajı kartta");
eq(button("Üret (38 kredi)") !== undefined, true, "hata sonrası kart yerinde, tekrar denenebilir");
console.log("3 yetersiz bakiye OK");

// 4) Kredi sistemi kapalı: ücretsiz yazar
await act(async () => root.unmount());
root = createRoot(el);
await act(async () => root.render(h(MediaJobCard, { card: card({ quote: quote({ credits_enabled: false, balance: null }) }), shopId: 7 })));
eq(text().includes("ücretsiz") && button("Üret") !== undefined, true, "kredi kapalıyken ücretsiz");
console.log("4 kredi sistemi kapalı OK");

// 5) Vazgeç: durdurma isteği
await act(async () => root.unmount());
root = createRoot(el);
calls.length = 0;
script = [job("stopped", [row(-1, { state: "skipped" }), row(-2, { state: "skipped" })], { skipped: 2 })];
await act(async () => root.render(h(MediaJobCard, { card: card(), shopId: 7 })));
await click(button("Vazgeç"));
eq(calls.find((c) => c.startsWith("POST")), "POST /api/shops/7/assistant/media-jobs/m1/stop", "vazgeç = durdur isteği");
eq(text().includes("Durduruldu"), true, "durduruldu özeti");
console.log("5 vazgeç OK");

console.log("MEDYA KARTI TESTLERİ GEÇTİ");
process.exit(0);

// Toplu taslak kartı: ilerlemeyi yoklar, ürün ürün durumu ve eksikleri gösterir, bitince yoklamayı keser, durdurma isteği gönderir.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/assistant", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: BatchJobCard } = await import("../../src/components/assistant/BatchJobCard.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const item = (index, state, extra = {}) => ({ index, images: 2, state, listing_id: null, title: "", missing: [], warnings: [], error: "", ...extra });
const job = (status, items) => {
  const count = (s) => items.filter((i) => i.state === s).length;
  return { job_id: "j1", status, total: items.length, done: count("done"), failed: count("failed"), skipped: count("skipped"), running: count("running"), listing_ids: items.filter((i) => i.listing_id).map((i) => i.listing_id), items };
};

const calls = [];
let script = [];
globalThis.__api = async (path, init) => { calls.push(`${init?.method ?? "GET"} ${path}`); return script.shift(); };

const el = document.createElement("div");
document.body.appendChild(el);
const root = createRoot(el);
const text = () => el.textContent;

// 1) Çalışan iş: ilk yoklama bir ürünü hazır getirir; sayfa eksikleri ve bağlantıyı gösterir
const start = job("running", [item(1, "running"), item(2, "queued"), item(3, "queued")]);
script = [job("running", [item(1, "done", { listing_id: 501, title: "Metal House Number Sign", missing: ["Fiyat gir."] }), item(2, "running"), item(3, "queued")])];
await act(async () => root.render(h(BatchJobCard, { card: { type: "batch_job", ...start }, shopId: 7 })));
await act(async () => { await sleep(30); });
eq(text().includes("Metal House Number Sign"), true, "hazır ürünün başlığı görünmeli");
eq(text().includes("Fiyat gir."), true, "eksik (fiyat) görünmeli");
eq(el.querySelector("a[href='/listings/501/edit']") !== null, true, "taslağa bağlantı");
eq(text().includes("1/3"), true, "ilerleme sayacı");
eq(calls[0], "GET /api/shops/7/assistant/batch-jobs/j1", "durum uç noktası yoklanır");
console.log("1 çalışan iş: başlık, eksik, bağlantı OK");

// 2) Sonraki yoklama işi bitirir: durum "Tamamlandı", durdur düğmesi kalkar, yoklama durur
script = [job("done", [item(1, "done", { listing_id: 501, title: "A" }), item(2, "failed", { error: "Taslak oluşturulamadı." }), item(3, "done", { listing_id: 502, title: "C" })])];
await act(async () => { await sleep(2700); });
eq(text().includes("Tamamlandı: 2 hazır, 1 olmadı"), true, "bitiş özeti");
eq(text().includes("Taslak oluşturulamadı."), true, "başarısız ürünün nedeni");
eq([...el.querySelectorAll("button")].some((b) => b.textContent === "Durdur"), false, "biten işte durdur düğmesi yok");
const polled = calls.length;
await act(async () => { await sleep(2700); });
eq(calls.length, polled, "bitince yoklama durur");
console.log("2 bitiş özeti ve yoklamanın durması OK");

// 3) Durdur: POST /stop gönderilir, yanıt kartı günceller
await act(async () => root.unmount());
calls.length = 0;
const running = job("running", [item(1, "running"), item(2, "queued")]);
script = [running, job("stopped", [item(1, "done", { listing_id: 9, title: "X" }), item(2, "skipped")])];
const root2 = createRoot(el);
await act(async () => root2.render(h(BatchJobCard, { card: { type: "batch_job", ...running }, shopId: 7 })));
await act(async () => { await sleep(30); });
const stopButton = [...el.querySelectorAll("button")].find((b) => b.textContent === "Durdur");
eq(stopButton !== undefined, true, "çalışan işte durdur düğmesi var");
await act(async () => stopButton.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(calls.at(-1), "POST /api/shops/7/assistant/batch-jobs/j1/stop", "durdurma isteği");
eq(text().includes("Durduruldu: 1 hazır, 1 atlandı"), true, "durduruldu özeti");
console.log("3 durdurma OK");

console.log("BATCH KART TESTLERİ GEÇTİ");
process.exit(0);

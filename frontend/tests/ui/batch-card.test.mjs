// Toplu taslak kartı: çözümleme yoklanır → düzenlenebilir ön kontrol (yalnızca değişenler gönderilir) → oluşturma ilerlemesi ve sonuç; durdurma.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/assistant", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: BatchJobCard } = await import("../../src/components/assistant/BatchJobCard.tsx");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spec = (extra = {}) => ({
  name: "Insulated tumbler", phrase: "insulated tumbler", digital: false, size: "", material: "", personalizable: true, personalization_detail: "", weight: 1.5, weight_unit: "lb", weight_estimated: true,
  unsure: ["size", "personalization_detail"], category_id: 1071, categories: [{ taxonomy_id: 1071, path: "Home & Living > Kitchen & Dining > Drinkware > Travel Mugs", share: 0.6 }, { taxonomy_id: 129, path: "Art & Collectibles > Sculpture > Art Objects", share: 0.2 }], error: "", ...extra,
});
const item = (index, state, extra = {}) => ({ index, images: 2, image_id: `img${index}`, files: [], analyzed: true, spec: spec(), state, listing_id: null, title: "", missing: [], warnings: [], estimated: [], error: "", ...extra });
const job = (status, items) => {
  const count = (s) => items.filter((i) => i.state === s).length;
  return { job_id: "j1", status, review: true, total: items.length, analyzed: items.filter((i) => i.analyzed).length, done: count("done"), failed: count("failed"), skipped: count("skipped"), running: count("running"), listing_ids: items.filter((i) => i.listing_id).map((i) => i.listing_id), items };
};

const calls = [];
let script = [];
globalThis.__api = async (path, init) => { calls.push({ call: `${init?.method ?? "GET"} ${path}`, body: init?.body ? JSON.parse(init.body) : null }); return script.shift(); };

const el = document.createElement("div");
document.body.appendChild(el);
const root = createRoot(el);
const text = () => el.textContent;
const setValue = async (input, value) => {
  const proto = input instanceof w.HTMLSelectElement ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value); input.dispatchEvent(new w.Event(input instanceof w.HTMLSelectElement ? "change" : "input", { bubbles: true })); });
};
const button = (label) => [...el.querySelectorAll("button")].find((b) => b.textContent === label);

// 1) Çözümleme sürerken: ilerleme yoklanır, bitince ön kontrol formu açılır
const start = job("analyzing", [item(1, "queued", { analyzed: false, spec: {} }), item(2, "queued", { analyzed: false, spec: {} })]);
script = [
  job("analyzing", [item(1, "queued"), item(2, "queued", { analyzed: false, spec: {} })]),
  job("review", [item(1, "queued"), item(2, "queued", { spec: spec({ name: "Butterfly wall art", weight: 4, size: "24x36 in", category_id: null }) })]),
];
await act(async () => root.render(h(BatchJobCard, { card: { type: "batch_job", ...start }, shopId: 7 })));
eq(text().includes("Ürünler çözümleniyor: 1/2"), true, "çözümleme ilerlemesi");
eq(calls[0].call, "GET /api/shops/7/assistant/batch-jobs/j1", "durum yoklanır");
await act(async () => { await sleep(2700); });
eq(text().includes("Ön kontrol"), true, "ön kontrol başlığı");
const inputs = () => [...el.querySelectorAll("input[maxlength='120']")];
eq(inputs().map((i) => i.value), ["Insulated tumbler", "Butterfly wall art"], "ürün adları düzenlenebilir kutularda");
const sizes = [...el.querySelectorAll("input[maxlength='80']")].filter((i) => i.placeholder);
eq(sizes[0].value, "", "bilinmeyen ölçü BOŞ (uydurulmaz)");
eq(sizes[0].className.includes("border-amber-400"), true, "bilinmeyen ve önemli alan vurgulanır");
eq(sizes[2].value === "24x36 in" || sizes.some((i) => i.value === "24x36 in"), true, "bilinen ölçü dolu");
eq(text().includes("tahmini"), true, "tahmini ağırlık işaretli");
eq(text().includes("Travel Mugs · %60"), true, "kategori seçeneği rakip oranıyla");
eq([...el.querySelectorAll("img")].map((i) => i.getAttribute("src")), ["/api/shops/7/assistant/images/img1", "/api/shops/7/assistant/images/img2"], "ürün resimleri küçük gösterilir");
console.log("1 çözümleme → ön kontrol formu OK");

// 2) Düzenleme: yalnızca değişen alanlar gönderilir; oluşturma başlar
await setValue(sizes[0], "40 oz");
await setValue(el.querySelectorAll("input[maxlength='200']")[0], "name engraving, 20 characters");
const category = [...el.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "129"));
await setValue(category, "129");
script = [job("running", [item(1, "running"), item(2, "queued")]), job("done", [item(1, "done", { listing_id: 501, title: "Insulated Tumbler With Handle", missing: ["Fiyat gir."], estimated: ["weight"] }), item(2, "done", { listing_id: 502, title: "Butterfly Wall Art" })])];
await act(async () => button("Taslakları oluştur").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
const post = calls.find((c) => c.call.startsWith("POST"));
eq(post.call, "POST /api/shops/7/assistant/batch-jobs/j1/start", "onay isteği");
eq(post.body, { items: [{ index: 1, size: "40 oz", personalization_detail: "name engraving, 20 characters", category_id: 129 }] }, "yalnızca kullanıcının değiştirdiği alanlar gider");
console.log("2 düzenleme ve onay OK");

// 3) Oluşturma sürer, sonra biter: başlık, eksik, tahmini değer, bağlantı; yoklama durur
await act(async () => { await sleep(2700); });
eq(text().includes("Tamamlandı: 2 hazır"), true, "bitiş özeti");
eq(text().includes("Insulated Tumbler With Handle") && text().includes("Fiyat gir."), true, "başlık ve eksik");
eq(text().includes("Tahmini değer var") && text().includes("ağırlık"), true, "tahmini değer uyarısı");
eq(el.querySelector("a[href='/listings/501/edit']") !== null, true, "taslağa bağlantı");
const polled = calls.length;
await act(async () => { await sleep(2700); });
eq(calls.length, polled, "bitince yoklama durur");
console.log("3 oluşturma ve sonuç OK");

// 4) Ön kontrolde vazgeç: iş durdurulur
await act(async () => root.unmount());
calls.length = 0;
const review = job("review", [item(1, "queued")]);
script = [job("stopped", [item(1, "skipped")])];
const root2 = createRoot(el);
await act(async () => root2.render(h(BatchJobCard, { card: { type: "batch_job", ...review }, shopId: 7 })));
await act(async () => button("Vazgeç").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(calls.find((c) => c.call.startsWith("POST")).call, "POST /api/shops/7/assistant/batch-jobs/j1/stop", "vazgeç = durdur isteği");
eq(text().includes("Durduruldu"), true, "durduruldu özeti");
console.log("4 vazgeç OK");

// 5) Dijital ürün: dosya adları görünür; dosyası olmayan dijital ürün uyarılır; dosyası olan ürün fiziksel seçilirse uyarılır
await act(async () => root2.unmount());
const root3 = createRoot(el);
const digitalReview = job("review", [
  item(1, "queued", { files: ["planner.pdf", "bonus.zip"], spec: spec({ digital: true, weight: null, weight_estimated: false }) }),
  item(2, "queued", { files: [], spec: spec({ digital: true, weight: null, weight_estimated: false }) }),
]);
await act(async () => root3.render(h(BatchJobCard, { card: { type: "batch_job", ...digitalReview }, shopId: 7 })));
eq(text().includes("planner.pdf, bonus.zip"), true, "dijital dosya adları ürünle birlikte görünür");
eq(text().includes("indirilebilir dosya yok"), true, "dosyası olmayan dijital ürün uyarılır");
const typeSelect = [...el.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "digital"));
await setValue(typeSelect, "physical");
eq(text().includes("bu dosyalar kullanılmaz"), true, "dosyası olan ürün fiziksel seçilirse uyarılır");
console.log("5 dijital dosyalar OK");

// 6) Adresler: kaynak rozeti ve okunan/okunamayan adresler görünür
await act(async () => root3.unmount());
const root4 = createRoot(el);
const linked = job("review", [item(1, "queued", { spec: spec({ size: "40 oz", from_link: ["size"], links: [
  { url: "https://shop.example/p/1", purpose: "product_info", title: "Tumbler 40 oz", source: "web", error: "" },
  { url: "https://gone.example/a", purpose: "reference_listing", title: "", source: "", error: "Sayfa okunamadı" },
] }) })]);
await act(async () => root4.render(h(BatchJobCard, { card: { type: "batch_job", ...linked }, shopId: 7 })));
eq(text().includes("adresten") || text().includes("from link"), true, "adresten gelen alan işaretli");
eq(text().includes("Tumbler 40 oz") && text().includes("Sayfa okunamadı"), true, "okunan ve okunamayan adresler görünür");
console.log("6 adresler OK");

console.log("BATCH KART TESTLERİ GEÇTİ");
process.exit(0);

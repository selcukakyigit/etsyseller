import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/discover", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: SearchPanel } = await import("../../src/components/discover/SearchPanel.tsx");

const item = (term, volume, extra = {}) => ({ term, demand: "high", volume, cpc: 0.8, competition: 50, monthly: [], trend_pct: null, intent: "commercial", crowded: false, mine: false, saved: false, ...extra });
const ALL = [item("large metal wall art", 1900), item("outdoor metal wall art", 2900), item("large outdoor metal wall art", 1000), item("metal wall decor", 800), item("outdoor metal sign", 500)];
const QUESTIONS = [item("how to hang metal wall art", 260), item("what is metal wall art", 90)];
const ready = (items, mode = "all") => ({ seed: "metal wall art", status: "ready", refused: null, seed_item: item("metal wall art", 18100), items, stale: false, total_volume: 0, mode, measured_at: "2026-10-23T10:00:00Z" });
const pending = (mode = "all") => ({ seed: "metal wall art", status: "pending", refused: null, seed_item: null, items: [], stale: false, total_volume: 0, mode, measured_at: null });

let calls = [], script = [];
globalThis.__api = async (path) => { calls.push(path); const next = script.shift(); return typeof next === "function" ? next(path) : next; };

const el = document.createElement("div"); document.body.appendChild(el);
const root = createRoot(el);
await act(async () => root.render(h(SearchPanel, { shopId: 1, collections: [], onSaved: () => {} })));

const text = () => document.body.textContent;
const rows = () => [...document.querySelectorAll("tbody tr")].map((r) => r.querySelector("td:nth-child(2) span")?.textContent);
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function search(q) {
  const input = document.querySelector("input[aria-label='Aranacak kelime']");
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(input, q); input.dispatchEvent(new w.Event("input", { bubbles: true })); });
  await act(async () => { document.querySelector("form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); });
}

// 1) ESKİ HATA: ilk aramanın sonucu (hazır geldiyse) ilk basışta görünmeli
script = [ready(ALL)];
await search("metal wall art");
eq(rows().length, 5, "İLK basışta sonuç görünmeli (eski hata: ancak ikinci basışta görünüyordu)");
eq(text().includes("Aranıyor"), false, "yükleme göstergesi kalmamalı");
console.log("1 ilk basışta sonuç görünüyor OK");

// 2) ilk arama 'hazırlanıyor' dönerse sayfa kendiliğinden yoklayıp sonucu getirmeli (ikinci basış gerekmez)
calls = []; script = [pending(), ready(ALL)];
await search("fresh seed word");
eq(text().includes("ilk kez araştırılıyor"), true, "hazırlanıyor mesajı");
await act(async () => { await sleep(2300); });
eq(rows().length, 5, "poll sonrası sonuç kendiliğinden gelmeli");
eq(calls.length, 2, "tam olarak bir yoklama");
console.log("2 'hazırlanıyor' -> otomatik yoklama -> sonuç OK");

// 3) çoklu kelime grubu: seçilenlerden herhangi birini içerenler (birleşim)
const chip = (word) => [...document.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent.startsWith(word));
await act(async () => chip("large").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(rows().sort(), ["large metal wall art", "large outdoor metal wall art"], "tek grup: large");
await act(async () => chip("outdoor").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(rows().sort(), ["large metal wall art", "large outdoor metal wall art", "outdoor metal sign", "outdoor metal wall art"], "iki grup seçilince birleşim (large VEYA outdoor)");
console.log("3 çoklu grup seçimi (birleşim) OK");

// 4) Sorular sekmesi: ayrı istek, ayrı liste; geri dönünce tekrar istek yok
calls = []; script = [ready(QUESTIONS, "questions")];
const tab = (label) => [...document.querySelectorAll("[role=tab]")].find((b) => b.textContent.startsWith(label));
await act(async () => tab("Sorular").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(calls.length, 1, "soru isteği");
eq(calls[0].includes("mode=questions"), true, "mode=questions gönderilmeli");
await act(async () => { await sleep(50); });
eq(rows().sort(), ["how to hang metal wall art", "what is metal wall art"], "Sorular sekmesinde yalnızca sorular (süzgeçler sıfırlanmış)");
console.log("4 Sorular sekmesi OK");

// 5) tüm kelimelere dönünce yeniden istek yok (önbellekten) ve süzgeçler temiz
calls = [];
await act(async () => tab("Tüm kelimeler").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(30); });
eq(calls.length, 0, "geri dönüşte yeniden istek atılmamalı");
eq(rows().length, 5, "tüm kelimeler listesi geri geldi");
// 6) Sorular sekmesine ikinci kez geçiş de istek atmaz
await act(async () => tab("Sorular").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(calls.length, 0, "soru listesi önbellekten");
console.log("5-6 sekmeler arası önbellek OK");

// 7) yeni arama sekmeyi 'tüm kelimeler'e ve süzgeçleri temize döndürür
script = [ready(ALL)];
await search("another seed");
eq(tab("Tüm kelimeler").getAttribute("aria-selected"), "true", "yeni arama tüm kelimelere döner");
console.log("7 yeni arama OK");

// 8) varyantlar tek satıra toplanır; "+N" ile açılır; "Varyasyonları ayır" düz liste verir
const VARIANTS = [item("metal wall art", 18100), item("art metal wall", 18100), item("metal art for the wall", 18100), item("outdoor metal wall art", 2900)];
script = [ready(VARIANTS)];
await search("variant seed");
eq(rows().length, 2, "3 varyant tek satıra toplanmalı (+ 'outdoor…' ayrı)");
const plus = [...document.querySelectorAll("tbody button[aria-expanded]")][0];
eq(plus.textContent.trim(), "+2", "+N rozeti");
await act(async () => plus.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(rows().length, 4, "+N açılınca varyantlar görünür");
await act(async () => plus.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(rows().length, 2, "tekrar kapanır");
const split = [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Varyasyonları ayır")).querySelector("input");
await act(async () => split.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(rows().length, 4, "'Varyasyonları ayır' düz liste");
console.log("8 varyant grupları OK");

// 9) tablo sabit yükseklikte kendi içinde kayar ve başlığı yapışkandır; satırlar zebra
const scroller = document.querySelector("tbody").closest("div");
eq(/overflow-auto/.test(scroller.className) && /max-h-/.test(scroller.className), true, "tablo kendi içinde kaymalı (sayfayı uzatmamalı)");
eq(/sticky/.test(document.querySelector("thead").className), true, "başlık yapışkan");
const tones = [...document.querySelectorAll("tbody tr")].map((r) => (r.className.includes("neutral-100/70") ? "gri" : "beyaz"));
eq(tones.slice(0, 4), ["beyaz", "gri", "beyaz", "gri"], "zebra: iki ton sırayla");
console.log("9 kaydırma, yapışkan başlık, zebra OK");

// 10) Yeniden araştır: refresh=true gider, eski liste görünürken yoklar, yeni liste eskisini değiştirir
calls = [];
script = [{ ...ready(VARIANTS), stale: true }, ready([item("rustic metal sign", 500)])];
const refreshBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Yeniden araştır"));
await act(async () => refreshBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(calls[0].includes("refresh=true"), true, "refresh=true gönderilmeli");
eq(text().includes("güncelleniyor"), true, "eski liste + 'güncelleniyor' görünmeli");
await act(async () => { await sleep(2300); });
eq(calls.length, 2, "bir yoklama");
eq(calls[1].includes("refresh=true"), false, "yoklama yeniden araştırma başlatmaz");
eq(rows(), ["rustic metal sign"], "yeni liste eskisini değiştirdi");
console.log("10 yeniden araştır OK");
console.log("PANEL DAVRANIŞ TESTLERİ GEÇTİ");
process.exit(0);

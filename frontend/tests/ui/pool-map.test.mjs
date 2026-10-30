// Yönetim > Araştırma > Genel bakış: havuzun ülke haritası (süzgeç, bölge, boyama ölçütü, pazar ayrıntısı, boş ve hata durumları).
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/research/overview", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: PoolMap } = await import("../../src/components/admin/research/PoolMap.tsx");
const { clearPageCache } = await import("../../src/lib/pageCache.ts");

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

const row = (market, o = {}) => ({ market, keywords: 0, with_volume: 0, volume: 0, avg_cpc: null, fresh: 0, stale: 0, coverage: 0, last_measured: null, spend_month: 0, calls_month: 0, default: false, configured: true, ...o });
const MAP = {
  language: "en", default_market: "US", terms: 200,
  rows: [
    row("US", { keywords: 180, with_volume: 170, volume: 98000, avg_cpc: 0.8, fresh: 150, stale: 30, coverage: 90, last_measured: "2026-10-28T10:00:00Z", spend_month: 1.25, calls_month: 20, default: true }),
    row("GB", { keywords: 100, with_volume: 80, volume: 14000, avg_cpc: 0.6, fresh: 100, stale: 0, coverage: 50, last_measured: "2026-10-29T10:00:00Z", spend_month: 0.075, calls_month: 1 }),
    row("DE"), row("MT", { configured: false }),
  ],
};
let calls = [];
let mapResponse = MAP;
globalThis.__api = async (path) => {
  calls.push(path);
  if (path.includes("/research/map")) { if (mapResponse instanceof Error) throw mapResponse; return mapResponse; }
  if (path.includes("/research/keywords")) {
    return { items: [
      { id: 1, term: "metal sign", search_volume: 5000, cpc: 0.7 }, { id: 2, term: "tiny sign", search_volume: null, cpc: null }, { id: 3, term: "garden sign", search_volume: 900, cpc: 0.4 },
    ], total: 3, page: 1, per_page: 50 };
  }
  throw new Error("beklenmeyen istek " + path);
};

async function mount() {
  clearPageCache();
  calls = [];
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(h(PoolMap)));
  await act(async () => { await sleep(80); }); // veri + harita yolları
  return { host, text: () => host.textContent, root, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const mapPaths = (m) => [...m.host.querySelectorAll("svg[role=group] path[aria-label]")];
const setInput = async (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new w.Event("input", { bubbles: true })); });
  await act(async () => { await sleep(40); });
};
const button = (m, text) => [...m.host.querySelectorAll("button")].find((b) => b.textContent === text);

// 1) ilk açılış: tablo, yalnızca verisi olan ülkeler haritada etkileşimli, ölçülmeyen pazar açıkça yazılır
let m = await mount();
eq(m.text().includes("Ülke haritası"), true, "başlık");
eq(calls.filter((c) => c.includes("/research/map")).length, 1, "açılışta tek harita isteği");
eq(calls[0].includes("?") ? calls[0].split("?")[1] : "", "", "süzgeç yokken parametre gitmez");
eq(mapPaths(m).length, 2, "yalnızca hacmi olan iki pazar etkileşimli (ABD, İngiltere)");
eq(mapPaths(m).every((p) => p.getAttribute("aria-label").includes("aylık arama")), true, "varsayılan boyama ölçütü hacim");
eq(m.text().includes("ölçülmedi"), true, "ölçülmemiş pazar tabloda 'ölçülmedi'");
eq(m.text().includes("%90") && m.text().includes("$1.25") || m.text().includes("1,25"), true, "kapsam ve harcama sütunları");
eq(m.text().includes("200 kelime süzgece uyuyor") && m.text().includes("2 pazarda ölçüm var"), true, "özet satırı");
console.log("1 ilk açılış OK");

// 2) boyama ölçütü: kapsam seçilince ipucu yüzdeyle konuşur; harcamada yalnızca harcaması olanlar renklenir
await act(async () => click(button(m, "Kapsam")));
eq(mapPaths(m).every((p) => p.getAttribute("aria-label").includes("kapsam")), true, "kapsam ölçütü");
await act(async () => click(button(m, "Harcama")));
eq(mapPaths(m).length, 2, "harcaması olan iki pazar");
await act(async () => click(button(m, "Hacim")));
console.log("2 boyama ölçütü OK");

// 3) bölge ve kelime süzgeci sunucuya gider (aynı süzgeç Keyword Explorer'daki ile)
eq(m.host.querySelector("input[placeholder='Kelime ara…']"), null, "süzgeçler varsayılan kapalı (harita yukarıda kalsın)");
await act(async () => click(button(m, "Kelime süzgeçleri")));
calls = [];
await act(async () => click(button(m, "AB")));
await act(async () => { await sleep(40); });
eq(calls.some((c) => c.includes("/research/map") && c.includes("region=eu")), true, "bölge sorguya girer");
calls = [];
await setInput(m.host.querySelector("input[placeholder='Kelime ara…']"), "garden");
eq(calls.some((c) => c.includes("/research/map") && c.includes("q=garden") && c.includes("region=eu")), true, "kelime süzgeci ve bölge birlikte gider");
eq(m.host.querySelector("select[aria-label='Sıralama']"), null, "haritada sıralama seçici yok");
eq([...m.host.querySelectorAll("option")].some((o) => o.textContent === "Metrik yok"), false, "'Metrik yok' haritada anlamsız: gizli");
await act(async () => click(button(m, "Dünya")));
await setInput(m.host.querySelector("input[placeholder='Kelime ara…']"), "");
eq(button(m, "Kelime süzgeçleri").textContent, "Kelime süzgeçleri", "süzgeç yokken sayaç görünmez");
console.log("3 süzgeç ve bölge OK");

// 4) pazar ayrıntısı: tablo satırına tıklayınca özet ve en çok aranan kelimeler (veri dönmeyenler hariç)
calls = [];
const gbRow = [...m.host.querySelectorAll("tbody tr")].find((r) => r.textContent.includes("GB"));
await act(async () => click(gbRow));
await act(async () => { await sleep(60); });
eq(calls.some((c) => c.includes("/research/keywords") && c.includes("market=GB") && c.includes("sort=volume")), true, "seçilen pazarın kelimeleri hacme göre istenir");
eq(m.text().includes("En çok aranan kelimeler") && m.text().includes("metal sign") && m.text().includes("garden sign"), true, "ayrıntıda en çok aranan kelimeler");
eq(m.text().includes("tiny sign"), false, "hacmi gelmeyen kelime listelenmez");
eq(m.text().includes("Ölçülen kelime") && m.text().includes("Bu ay harcama"), true, "özet sayılar");
await act(async () => click(gbRow));
eq(m.text().includes("Ölçülen kelime"), false, "aynı satıra yeniden tıklayınca ayrıntı kapanır");
// haritadan seçim: ülkeye tıklamak seçer (ipucunu değil)
await act(async () => click(mapPaths(m)[0]));
await act(async () => { await sleep(40); });
eq(m.text().includes("Ölçülen kelime"), true, "haritada ülkeye tıklayınca ayrıntı açılır");
console.log("4 pazar ayrıntısı OK");
await m.unmount();

// 5) boş havuz ve ölçülmemiş pazarlar; yapılandırılmamış pazar etiketi
mapResponse = { language: "en", default_market: "US", terms: 0, rows: [row("US", { default: true }), row("MT", { configured: false })] };
m = await mount();
eq(mapPaths(m).length, 0, "ölçüm yokken etkileşimli ülke yok");
eq(m.text().includes("0 pazarda ölçüm var"), true, "ölçüm yok uyarısı");
await act(async () => click([...m.host.querySelectorAll("tbody tr")].find((r) => r.textContent.includes("MT"))));
eq(m.text().includes("haftalık ölçüme dahil değil"), true, "yapılandırılmamış pazar etiketi");
await m.unmount();

// 6) hata: yalnızca bu bölüm hata gösterir
mapResponse = new Error("sunucu hatası");
m = await mount();
eq(m.text().includes("sunucu hatası"), true, "hata metni");
eq(m.host.querySelectorAll("svg[role=group]").length, 0, "hatada harita çizilmez");
await m.unmount();

console.log("YÖNETİM ÜLKE HARİTASI TESTLERİ GEÇTİ");

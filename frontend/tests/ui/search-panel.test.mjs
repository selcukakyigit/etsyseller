import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/discover", pretendToBeVisual: true });
const w = dom.window;
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, history: w.history, IS_REACT_ACT_ENVIRONMENT: true });
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: SearchPanel } = await import("../../src/components/discover/SearchPanel.tsx");

const item = (term, volume, extra = {}) => ({ term, demand: "high", volume, cpc: 0.8, competition: 50, difficulty: 40, monthly: [], last_month: null, trend_pct: null, intent: "commercial", crowded: false, mine: false, saved: false, ...extra });
const ALL = [item("large metal wall art", 1900), item("outdoor metal wall art", 2900), item("large outdoor metal wall art", 1000), item("metal wall decor", 800), item("outdoor metal sign", 500)];
const QUESTIONS = [item("how to hang metal wall art", 260), item("what is metal wall art", 90)];
const ready = (items, mode = "all") => ({ seed: "metal wall art", status: "ready", refused: null, seed_item: item("metal wall art", 18100), items, stale: false, total_volume: 0, mode, measured_at: "2026-10-23T10:00:00Z" });
const pending = (mode = "all") => ({ seed: "metal wall art", status: "pending", refused: null, seed_item: null, items: [], stale: false, total_volume: 0, mode, measured_at: null });

const HOME = {
  tags: [item("metal farm sign", 18100), item("barn decor", 900), item("ranch gate", null)],
  upcoming: [{ ...item("christmas ornaments", 22000), in_months: 1, peak_months: [11, 12] }, { ...item("pumpkin sign", 8000), in_months: 0, peak_months: [10] }],
  collections: [{ name: "Farm", count: 3 }],
  preparing: false,
};
let allowanceCalls = 0;
let allowance = { month_limit: 150, month_used: 38, day_limit: 40, day_used: 3, remaining: 37 };
let homeCalls = 0;
let calls = [], script = [];
globalThis.__api = async (path) => {
  if (path.includes("/discover/home")) { homeCalls++; return HOME; }
  if (path.includes("/discover/allowance")) { allowanceCalls++; return allowance; }
  calls.push(path); const next = script.shift(); return typeof next === "function" ? next(path) : next;
};

const el = document.createElement("div"); document.body.appendChild(el);
const root = createRoot(el);
await act(async () => root.render(h(SearchPanel, { shopId: 1, collections: [], onSaved: () => {} })));

const text = () => document.body.textContent;
const rows = () => [...document.querySelectorAll("tbody tr")].map((r) => r.querySelector("td[class*='max-w-'] > :is(span, button[title^='Ayrıntıyı'])")?.textContent);
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
eq(text().includes("analiz ediyoruz"), true, "hazırlanıyor mesajı");
eq(/havuz|DataForSEO|pool/i.test(text()), false, "kullanıcıya iç işleyiş (havuz, sağlayıcı adı) gösterilmemeli");
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

// 4) Sorular sekmesi: sayfa DEĞİŞMEZ (yalnızca tablo bölgesi yüklenir), kendi süzgeci vardır
calls = [];
script = [async () => { await sleep(300); return ready(QUESTIONS, "questions"); }];
const tab = (label) => [...document.querySelectorAll("[role=tab]")].find((b) => b.textContent.startsWith(label));
await act(async () => tab("Sorular").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(calls.length, 1, "soru isteği");
eq(calls[0].includes("mode=questions"), true, "mode=questions gönderilmeli");
// yükleme sürerken: sekmeler, özet kart, koleksiyon çubuğu, gruplar ve süzgeçler YERİNDE; yalnızca liste bölgesi bekliyor
eq(Boolean(document.querySelector("[role=tablist]")), true, "yüklerken sekmeler yerinde");
eq(text().includes("Aylık arama (Google)"), true, "yüklerken özet kart yerinde");
eq(text().includes("Koleksiyon:"), true, "yüklerken koleksiyon çubuğu yerinde");
eq(Boolean(document.querySelector("input[aria-label='İçerilecek kelimeler']")), true, "yüklerken süzgeçler yerinde");
eq(text().includes("Sorular getiriliyor"), true, "liste bölgesinde yükleme mesajı");
eq(tab("Sorular").getAttribute("aria-selected"), "true", "sekme seçili");
await act(async () => { await sleep(400); });
eq(rows().sort(), ["how to hang metal wall art", "what is metal wall art"], "Sorular sekmesinde yalnızca sorular (kendi süzgeci temiz)");
console.log("4 Sorular sekmesi: sayfa sabit, yalnızca liste yükleniyor OK");

// 5) tüm kelimelere dönünce: yeniden istek yok, o sekmenin süzgeci KORUNUR (large VEYA outdoor); sorulara dönünce de önbellekten
calls = [];
await act(async () => tab("Tüm kelimeler").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(30); });
eq(calls.length, 0, "geri dönüşte yeniden istek atılmamalı");
eq(rows().length, 4, "tüm kelimeler sekmesinde eski süzgeç korunmuş (large VEYA outdoor)");
eq(chip("large").getAttribute("aria-pressed"), "true", "seçili grup chip'i korunmuş");
await act(async () => tab("Sorular").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(calls.length, 0, "soru listesi önbellekten");
eq(rows().length, 2, "soru listesi hemen görünür");
console.log("5-6 sekmeler arası önbellek ve süzgeç durumu OK");

// 7) yeni arama sekmeyi 'tüm kelimeler'e ve süzgeçleri temize döndürür
script = [ready(ALL)];
await search("another seed");
eq(tab("Tüm kelimeler").getAttribute("aria-selected"), "true", "yeni arama tüm kelimelere döner");
eq(rows().length, 5, "yeni aramada süzgeçler temiz");
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

// 11) SAYFA YENİLEME: arama URL'de (?q=) kalır, yenilenince sonuç kendiliğinden yeniden gelir ve kutuda yazılı durur
await act(async () => root.unmount());
const { clearPageCache } = await import("../../src/lib/pageCache.ts");
clearPageCache(); // gerçek yenilemede bellek önbelleği de boşalır
w.history.replaceState(null, "", "/discover?q=metal+wall+art");
calls = []; script = [ready(ALL)];
const root2 = createRoot(document.body.appendChild(document.createElement("div")));
await act(async () => root2.render(h(SearchPanel, { shopId: 1, collections: [], onSaved: () => {} })));
await act(async () => { await sleep(80); });
eq(calls.length, 1, "yenilemede arama otomatik yüklenmeli");
eq(calls[0].includes("q=metal%20wall%20art"), true, "URL'deki kelime aranmalı");
eq(rows().length >= 5, true, "sonuç ekranda");
eq(document.querySelector("input[aria-label='Aranacak kelime']").value, "metal wall art", "arama kutusu dolu kalmalı");
console.log("11 yenilemede arama kalıyor OK");

// 12) KOLEKSİYON: yokken önce oluştur; oluşturulunca satırdaki yeşil + ile tek dokunuşta ekle, ✓ ile çıkar; toplu seçim aktif koleksiyona ekler
const server = new Set();
globalThis.__api = async (path, init) => {
  if (path.includes("/discover/home")) return HOME;
  calls.push(path + (init?.body ? " " + init.body : ""));
  if (path.includes("/discover/search")) return ready(ALL);
  if (path.includes("/discover/saved/remove")) { for (const t of JSON.parse(init.body).terms) server.delete(t); return { removed: 1 }; }
  if (path.includes("/discover/saved") && init?.method === "POST") { for (const t of JSON.parse(init.body).terms) server.add(t); return { added: 1 }; }
  if (path.includes("/discover/saved")) return { collections: server.size ? [{ name: "Farm", count: server.size }] : [], collection: "Farm", total: server.size, items: [...server].map((term) => item(term, 1)) };
  throw new Error("beklenmeyen istek " + path);
};
localStorage.clear();
await act(async () => root2.unmount());
w.history.replaceState(null, "", "/discover");
clearPageCache();
const root3 = createRoot(document.body.appendChild(document.createElement("div")));
await act(async () => root3.render(h(SearchPanel, { shopId: 1, collections: [], onSaved: () => {} })));
await search("metal wall art");
const plusBtns = () => [...document.querySelectorAll("tbody button[aria-label$='koleksiyona ekle']")];
const doneBtns = () => [...document.querySelectorAll("tbody button[aria-label$='koleksiyondan çıkar']")];
eq(plusBtns().length > 0 && plusBtns().every((b) => b.disabled), true, "koleksiyon yokken + kapalı olmalı");
eq(text().includes("önce bir koleksiyon oluştur"), true, "oluşturma uyarısı görünmeli");
// oluştur
const nameInput = document.querySelector("input[aria-label='Koleksiyon adı']");
const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
await act(async () => { setter.call(nameInput, "Farm"); nameInput.dispatchEvent(new w.Event("input", { bubbles: true })); });
await act(async () => { nameInput.closest("form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); });
await act(async () => { await sleep(30); });
eq(plusBtns().every((b) => !b.disabled), true, "koleksiyon oluşturulunca + açılmalı");
eq(server.size, 0, "oluşturmak tek başına kayıt yaratmaz (ilk kelime eklenince kalıcı olur)");
// tek dokunuşla ekle
calls = [];
const first = plusBtns()[0];
await act(async () => first.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(30); });
eq(server.size, 1, "tek dokunuş kelimeyi kaydetmeli");
eq(calls.some((c) => c.includes('"collection":"Farm"')), true, "aktif koleksiyona kaydedilmeli");
eq(doneBtns().length, 1, "eklenen satır ✓ olmalı");
// ✓ ile çıkar
await act(async () => doneBtns()[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(30); });
eq(server.size, 0, "✓'ye dokununca koleksiyondan çıkmalı");
eq(doneBtns().length, 0, "satır tekrar + olmalı");
// toplu: iki satır seç, çubuktaki düğmeyle ekle
const boxes = [...document.querySelectorAll("tbody input[type=checkbox]")];
await act(async () => boxes[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => boxes[1].dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
const bulk = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("koleksiyonuna ekle"));
eq(Boolean(bulk) && !bulk.disabled, true, "toplu ekleme düğmesi aktif koleksiyonu göstermeli");
await act(async () => bulk.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(30); });
eq(server.size, 2, "seçilen iki kelime eklenmeli");
eq(doneBtns().length, 2, "ikisi de ✓");
console.log("12 koleksiyon: oluştur, tek dokunuş, çıkar, toplu OK");

// 13) DÜZEN SIRASI (yukarıdan aşağı): sekmeler, koleksiyon çubuğu, araç çubuğu (solda Etsy, sağda CSV + Yeniden araştır), gruplar, süzgeçler, liste
const before = (a, b) => Boolean(a.compareDocumentPosition(b) & w.Node.DOCUMENT_POSITION_FOLLOWING);
const q$ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent.includes(label));
const elTabs = q$("[role=tablist]"), elCol = [...document.querySelectorAll("span")].find((s) => s.textContent === "Koleksiyon:");
const elEtsy = btn("Etsy'de kaç ilan"), elCsv = btn("CSV indir"), elRef = btn("Yeniden araştır");
const elGroups = q$("[aria-label='Kelime grupları']"), elFilter = q$("input[aria-label='İçerilecek kelimeler']"), elTable = q$("tbody");
eq([before(elTabs, elCol), before(elCol, elEtsy), before(elEtsy, elCsv), before(elCsv, elRef), before(elRef, elGroups), before(elGroups, elFilter), before(elFilter, elTable)], [true, true, true, true, true, true, true], "blok sırası");
eq(/justify-between/.test(elEtsy.parentElement.className), true, "araç çubuğu iki uca yaslı (Etsy solda, diğerleri sağda)");
eq(elCsv.parentElement.contains(elRef), true, "CSV ve Yeniden araştır sağ grupta");
console.log("13 düzen sırası OK");

// 14) ETSY İLK 20 ANALİZİ: satırdaki düğme sabit boyutlu pencereyi açar; Etsy verisi olarak etiketli; Sorular sekmesinde düğme yok
const ANALYSIS = { term: "large metal wall art", total: 775484, sample: 20, currency: "USD", price: { p25: 41.9, median: 58, p75: 93.5 }, proven: 3, strong: 1,
  favorites: { p75: 6, max: 408 }, views: { median: 10 }, age_days_median: 39, new_share: 0.75, top_tags: [{ tag: "metal wall art", count: 14 }, { tag: "housewarming gift", count: 5 }],
  listings: [{ listing_id: 1, title: "Tree of Life Wall Art", url: "https://etsy.test/1", image: "https://img.test/1.jpg", price: 34, currency: "USD", favorites: 408, views: 5000, age_days: 400, shop_id: 1, personalizable: false },
             { listing_id: 2, title: "Butterfly Sculpture", url: "https://etsy.test/2", image: null, price: 60, currency: "USD", favorites: 0, views: 3, age_days: 20, shop_id: 2, personalizable: false }] };
calls = [];
const prevApi = globalThis.__api;
globalThis.__api = async (path, init) => {
  calls.push(path);
  if (path.includes("/etsy-top")) return { analysis: ANALYSIS, limited: false };
  if (path.includes("mode=questions")) return ready(QUESTIONS, "questions");
  return prevApi(path, init);
};
const analyzeBtn = () => document.querySelector("tbody button[aria-label$='deki ilanlara bak']");
await act(async () => analyzeBtn().dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(40); });
const dialog = document.querySelector("[role=dialog]");
eq(Boolean(dialog), true, "analiz penceresi açılmalı");
eq(calls.some((c) => c.includes("/etsy-top")), true, "analiz uç noktası çağrılmalı");
eq(dialog.textContent.includes("Etsy verisi (Google değil)"), true, "Etsy verisi olarak etiketli olmalı");
eq(dialog.textContent.includes("10+ favorili ilan"), true, "örnekte 10+ favorili ilan sayısı");
eq(/Düşük|Orta|Yüksek/.test(dialog.textContent), false, "rekabet gücü hükmü (düşük/orta/yüksek) gösterilmemeli");
eq(dialog.textContent.includes("ilk sayfa değildir"), true, "örnek olduğu, sitedeki ilk sayfa olmadığı yazılı");
eq(dialog.textContent.includes("housewarming gift") && dialog.textContent.includes("Tree of Life Wall Art"), true, "rakip etiketleri ve ilan listesi");
const headBtns = () => [...dialog.querySelectorAll(".sticky button")];
eq(headBtns().map((b) => b.firstChild.textContent), ["#", "Fiyat", "Favori", "Görüntülenme", "İlan yaşı"], "listede sütun başlıkları olmalı");
const order = () => [...dialog.querySelectorAll("ul li")].map((li) => li.querySelector("span.truncate").textContent);
const clickHead = async (name) => { await act(async () => headBtns().find((b) => b.firstChild.textContent === name).dispatchEvent(new w.MouseEvent("click", { bubbles: true }))); };
eq(order(), ["Tree of Life Wall Art", "Butterfly Sculpture"], "başlangıçta Etsy API sırası");
await clickHead("Favori");
eq(order(), ["Tree of Life Wall Art", "Butterfly Sculpture"], "favori: ilk tıklama çoktan aza (408 önde)");
await clickHead("Favori");
eq(order(), ["Butterfly Sculpture", "Tree of Life Wall Art"], "favori: ikinci tıklama azdan çoğa");
eq([...dialog.querySelectorAll("ul li")].map((li) => li.children[0].textContent), ["2", "1"], "sıralansa da # özgün API sırasını gösterir");
await clickHead("Fiyat");
eq(order(), ["Butterfly Sculpture", "Tree of Life Wall Art"], "fiyat: ilk tıklama pahalıdan ucuza ($60 önde)");
await clickHead("İlan yaşı");
eq(order(), ["Tree of Life Wall Art", "Butterfly Sculpture"], "yaş: ilk tıklama en eski önde (400 gün)");
eq(headBtns().find((b) => b.firstChild.textContent === "İlan yaşı").textContent.includes("▼"), true, "etkin sütunda yön oku");
await clickHead("#");
await clickHead("#");
await clickHead("#");
eq(order()[0], "Tree of Life Wall Art", "# ile özgün sıraya dönülür (ikinci tıklama ters, üçüncü yine API sırası)");
eq(dialog.textContent.includes("12.211") || dialog.textContent.includes("5.000") || dialog.textContent.includes("400"), true, "görüntülenme ve yaş ayrı sütunlarda");
eq(dialog.querySelectorAll("img[src='https://img.test/1.jpg']").length, 1, "küçük resim görünmeli (resmi olmayan ilanda boş kutu)");
eq(dialog.querySelectorAll(`a[title="Etsy'de aç"][href="https://etsy.test/2"]`).length, 1, "her satırda Etsy'de aç simgesi");
eq(/min-h-\[30rem\]/.test(dialog.innerHTML) && /max-h-80[^"]*overflow-auto/.test(dialog.innerHTML), true, "sabit minimum yükseklik ve kendi içinde kayan liste");
await act(async () => document.querySelector("[role=dialog] button[aria-label='Kapat']").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(Boolean(document.querySelector("[role=dialog]")), false, "pencere kapanmalı");
await act(async () => tab("Sorular").dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(40); });
eq(Boolean(analyzeBtn()), false, "Sorular sekmesinde Etsy analiz düğmesi olmamalı (soru kalıbı Etsy'de anlamlı arama değil)");
console.log("14 Etsy ilk 20 analizi OK");

// 16) KELİME PENCERESİ: kelimeye tıklayınca ayrıntı penceresi; mevsimsellik hazırlanırken iskelet, sonra çubuklar; Etsy rekabetine geçiş
const tabAll = [...document.querySelectorAll("[role=tab]")].find((b) => b.textContent.includes("Tüm kelimeler"));
await act(async () => tabAll.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(40); });
let seasonCalls = 0;
const api14 = globalThis.__api;
globalThis.__api = async (path, init) => {
  if (path.includes("/discover/season")) { seasonCalls++; return { season: seasonCalls < 2 ? { monthly: [], peak_months: [], seasonal: false, pending: true } : { monthly: [11, 5, 3, 4, 4, 5, 6, 8, 13, 28, 100, 92], peak_months: [11, 12], seasonal: true, pending: false } }; }
  return api14(path, init);
};
const openBtn = document.querySelector("tbody button[title^='Ayrıntıyı aç']");
eq(Boolean(openBtn), true, "kelime tıklanabilir olmalı");
const termName = openBtn.textContent;
await act(async () => openBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(40); });
let dlg = document.querySelector("[role=dialog]");
eq(Boolean(dlg) && dlg.textContent.includes(termName), true, "kelime penceresi açılmalı");
eq(seasonCalls, 1, "mevsimsellik istenmeli");
eq(Boolean(dlg.querySelector("[data-testid=season-pending]")), true, "hazırlanırken iskelet");
eq(dlg.querySelector("[data-testid=monthly-chart]").textContent.includes("Aylık seri yok"), true, "aylık seri yoksa açıklama");
await act(async () => { await sleep(2700); });
eq(seasonCalls, 2, "hazır olana dek yoklar");
dlg = document.querySelector("[role=dialog]");
eq(dlg.querySelectorAll("[data-testid=season] [title]").length, 12, "mevsimsellik çubukları");
const barHeights = [...dlg.querySelectorAll("[data-testid=season] [title] > div")].map((d) => parseInt(d.style.height));
eq([...dlg.querySelectorAll("[data-testid=season] [title] > span:first-of-type")].map((e) => e.textContent)[10], "100", "mevsimsellik çubuklarının üstünde değer");
eq(barHeights.every((h) => h >= 2) && Math.max(...barHeights) === 56, true, "çubuk yükseklikleri piksel olarak verilmeli (yüzde sıfıra düşer)");
eq(/min-h-\[28rem\]/.test(dlg.innerHTML), true, "sabit minimum yükseklik");
const toEtsy = [...dlg.querySelectorAll("button")].find((b) => b.textContent.includes("Etsy'deki ilanlara bak"));
await act(async () => toEtsy.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(40); });
eq(document.querySelectorAll("[role=dialog]").length, 1, "tek pencere: kelime penceresi kapanıp Etsy analizi açılmalı");
eq(document.querySelector("[role=dialog]").textContent.includes("Etsy verisi (Google değil)"), true, "Etsy analizi açıldı");
const { default: KeywordDetailModal } = await import("../../src/components/discover/KeywordDetailModal.tsx");
const withSeries = item("metal wall art", 18100, { monthly: [10, 12, 14, 20, 30, 40, 50, 60, 55, 70, 90, 120000], last_month: "2026-09", trend_pct: 40 });
const detailRoot = createRoot(document.body.appendChild(document.createElement("div")));
await act(async () => detailRoot.render(h(KeywordDetailModal, { shopId: 1, item: withSeries, onClose: () => {} })));
await act(async () => { await sleep(40); });
const chart = document.querySelector("[data-testid=monthly-chart]");
eq(chart.querySelectorAll("[title]").length, 12, "12 aylık arama çubuğu");
const heights = [...chart.querySelectorAll("[title] > div")].map((d) => parseInt(d.style.height));
eq(heights[11], 80, "en yüksek ay tam yükseklikte (px)");
const monthRow = [...chart.querySelectorAll("[title] > span:nth-of-type(2)")].map((e) => e.textContent);
eq(monthRow, ["Eki", "Kas", "Ara", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl"], "her çubuğun altında ay adı (son ay Eylül 2026'dan geriye)");
eq([...chart.querySelectorAll("[title] > span:nth-of-type(3)")].map((e) => e.textContent).filter(Boolean), ["2025", "2026"], "yıl ilk çubukta ve Ocak'ta yazılı");
eq([...chart.querySelectorAll("[title] > span:first-of-type")].map((e) => e.textContent)[0], "10", "her çubuğun üstünde değer");
eq([...chart.querySelectorAll("[title] > span:first-of-type")].map((e) => e.textContent)[11].length < 8, true, "büyük sayılar kısa yazılır");
// profil çıkarılamadıysa (çok az aranan kelime) sessizce boş kalmaz, nedeni yazılır
globalThis.__api = async (path) => (path.includes("/discover/season") ? { season: { monthly: [], peak_months: [], seasonal: false, pending: false, too_rare: true, min_volume: 100 } } : api14(path));
await act(async () => detailRoot.render(h(KeywordDetailModal, { shopId: 1, item: item("metal tree farm sign", 10, { monthly: [10, 10, 20, 10, 10, 10, 0, 10, 0, 10, 10, 10], last_month: "2026-09" }), onClose: () => {} })));
await act(async () => { await sleep(60); });
const lastDlg = [...document.querySelectorAll("[role=dialog]")].pop();
eq(lastDlg.textContent.includes("100'in altında") && lastDlg.textContent.includes("hesaplanmadı"), true, "az aranan kelimede nedeni (eşik) yazılı olmalı");
eq(Boolean(lastDlg.querySelector("[data-testid=season-pending]")), false, "iskelet takılı kalmamalı");
console.log("16 kelime penceresi OK");
globalThis.__api = prevApi;

// 15) MEVSİMSELLİK: 12 çubuk, zirve aylar vurgulu ve yazılı; hazırlanırken iskelet; profil yoksa hiçbir şey; dengeli ise "Yıl boyu dengeli"
const { default: OverviewCard } = await import("../../src/components/discover/OverviewCard.tsx");
const cardHost = document.body.appendChild(document.createElement("div"));
const cardRoot = createRoot(cardHost);
const renderCard = (season) => act(async () => cardRoot.render(h(OverviewCard, { item: item("christmas ornaments", 1000), selected: false, onToggle: () => {}, season })));
const PROFILE = [11, 5, 3, 4, 4, 5, 6, 8, 13, 28, 100, 92];
await renderCard({ monthly: PROFILE, peak_months: [11, 12], seasonal: true, pending: false });
eq(cardHost.querySelectorAll("[data-testid=season] [title]").length, 12, "12 aylık çubuk");
eq(parseInt(cardHost.querySelectorAll("[data-testid=season] [title] > div")[10].style.height), 56, "zirve çubuğu tam yükseklikte (px)");
eq(cardHost.querySelector("[data-testid=season]").textContent.includes("Zirve: Kas, Ara"), true, "zirve aylar yazılı");
eq(cardHost.querySelectorAll("[data-testid=season] .bg-\\[\\#D97757\\]").length, 2, "yalnız zirve aylar vurgulu");
await renderCard({ monthly: [], peak_months: [], seasonal: false, pending: true });
eq(Boolean(cardHost.querySelector("[data-testid=season-pending]")), true, "hazırlanırken iskelet");
await renderCard({ monthly: [], peak_months: [], seasonal: false, pending: false });
eq(Boolean(cardHost.querySelector("[data-testid=season]") || cardHost.querySelector("[data-testid=season-pending]")), false, "profil çıkmadıysa bölüm gizli");
await renderCard({ monthly: Array(12).fill(95), peak_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], seasonal: false, pending: false });
eq(cardHost.querySelector("[data-testid=season]").textContent.includes("Yıl boyu dengeli"), true, "dengeli kelime");
eq(cardHost.querySelectorAll("[data-testid=season] .bg-\\[\\#D97757\\]").length, 0, "dengeli kelimede vurgu yok");
await renderCard({ monthly: [], peak_months: [], seasonal: false, pending: false, too_rare: true, min_volume: 100 });
eq(cardHost.querySelector("[data-testid=season-rare]").textContent.includes("100'in altında"), true, "kartta da az aranan kelime için açıklama");
console.log("15 mevsimsellik OK");

// 17) BOŞ EKRAN: son aramalar, yaklaşan sezon, mağazandan başla, koleksiyonlar; tıklayınca araştırır; son aramalar hatırlanır
const { clearPageCache: clearCache17 } = await import("../../src/lib/pageCache.ts");
const HOME_BEFORE = globalThis.__api;
let preparingHome = false;
globalThis.__api = async (path, init) => {
  if (path.includes("/discover/home")) { homeCalls++; return preparingHome ? { ...HOME, upcoming: [], preparing: true } : HOME; }
  calls.push(path);
  return path.includes("/discover/search") ? ready(ALL) : HOME_BEFORE(path, init);
};
const mount17 = async (props = {}) => {
  w.history.replaceState(null, "", "/discover");
  clearCache17();
  const host = document.body.appendChild(document.createElement("div"));
  const r = createRoot(host);
  await act(async () => r.render(h(SearchPanel, { shopId: 1, collections: [], onSaved: () => {}, ...props })));
  await act(async () => { await sleep(60); });
  return { host, r };
};
localStorage.clear();
let openedSaved = 0;
let m = await mount17({ onOpenSaved: () => { openedSaved++; } });
const sectionTitles = () => [...m.host.querySelectorAll("h2")].map((e) => e.textContent);
eq(sectionTitles(), ["Yaklaşan sezon", "Mağazandan başla", "Koleksiyonların"], "ilk açılışta son arama yok; diğer bölümler var");
const cards = [...m.host.querySelectorAll("button")].filter((b) => b.textContent.includes("Zirve"));
eq(cards.length, 2, "iki yaklaşan sezon kartı");
eq(cards[0].textContent.includes("Zirve: Kas, Ara") && cards[0].textContent.includes("1 ay sonra") && cards[0].textContent.includes("22.000"), true, "zirve ayları, kalan süre ve Google aylık araması");
eq(cards[1].textContent.includes("şimdi zirvede"), true, "bu ay zirvedeyse 'şimdi zirvede'");
eq(/havuz|DataForSEO|pool|kuyruk|API/i.test(m.host.textContent), false, "iç işleyiş kelimeleri görünmemeli");
const tagChip = [...m.host.querySelectorAll("button")].find((b) => b.textContent.startsWith("barn decor"));
eq(tagChip.textContent.includes("900"), true, "etiketin yanında Google aylık araması (ölçülmüşse)");
const rangeChip = [...m.host.querySelectorAll("button")].find((b) => b.textContent.startsWith("ranch gate"));
eq(/\d/.test(rangeChip.textContent), false, "ölçülmemiş etiketin yanında sayı yok");
const col = [...m.host.querySelectorAll("button")].find((b) => b.textContent.startsWith("Farm"));
await act(async () => col.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(openedSaved, 1, "koleksiyona tıklayınca Kaydedilenler sekmesi açılır");

// etikete tıklamak o kelimeyi araştırır ve son aramalara yazar
calls = [];
await act(async () => tagChip.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
await act(async () => { await sleep(60); });
eq(calls.some((c) => c.includes("/discover/search") && c.includes("q=barn%20decor")), true, "tıklanan etiket araştırılmalı (tek tıkla, ikinci basış gerekmez)");
eq(m.host.querySelectorAll("tbody tr").length, 5, "sonuç ilk tıklamada görünür");
eq(JSON.parse(localStorage.getItem("ulagg:discover-recent:1")), ["barn decor"], "arama son aramalara yazıldı");
await act(async () => m.r.unmount());
m.host.remove();

// yeniden açılışta son arama çipi görünür; bir çip aramayı yeniden başlatır; Temizle siler
m = await mount17();
eq(sectionTitles()[0], "Son aramaların", "son aramalar en üstte");
const recentChip = [...m.host.querySelectorAll("section")][0].querySelector("button.rounded-full");
eq(recentChip.textContent, "barn decor", "son arama çipi");
const clearBtn = [...m.host.querySelectorAll("button")].find((b) => b.textContent === "Temizle");
await act(async () => clearBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true })));
eq(sectionTitles().includes("Son aramaların"), false, "Temizle ile son aramalar silinir");
await act(async () => m.r.unmount());
m.host.remove();

// mevsimsellikler hazırlanırken yer tutucu metin; bir süre sonra kendiliğinden yeniden sorar
preparingHome = true;
homeCalls = 0;
m = await mount17();
eq(m.host.textContent.includes("sezonları hesaplanıyor"), true, "hazırlanırken açıklama");
preparingHome = false;
await act(async () => { await sleep(5400); });
eq(homeCalls >= 2, true, "hazırlanıyorsa ekran yeniden sorar");
eq(m.host.textContent.includes("sezonları hesaplanıyor"), false, "hazır olunca açıklama kalkar");
eq(m.host.querySelectorAll("h2").length >= 2 && m.host.textContent.includes("christmas ornaments"), true, "hazır olunca yaklaşan sezon kartları gelir");
await act(async () => m.r.unmount());
m.host.remove();
globalThis.__api = HOME_BEFORE;
console.log("17 boş ekran: son aramalar, yaklaşan sezon, etiketler, koleksiyonlar OK");

// 18) Kalan yeni araştırma hakkı gösterilir; her aramadan sonra yeniden okunur; hak bitince 0 görünür
{
  const lastApi = globalThis.__api; // önceki senaryolar API taklidini değiştirmiş olabilir: yalnızca hak uç noktasını ekle, gerisini ona bırak
  globalThis.__api = async (path, init) => (path.includes("/discover/allowance") ? (allowanceCalls++, allowance) : lastApi(path, init));
  script = [ready(ALL)];
  await search("allowance seed word");
  await act(async () => { await sleep(50); });
  eq(/112 \/ 150/.test(text()), true, "aylık kalan hak görünmeli (150 - 38 = 112)");
  const callsBefore = allowanceCalls;
  allowance = { month_limit: 150, month_used: 150, day_limit: 40, day_used: 5, remaining: 0 };
  script = [ready(ALL)];
  await search("another seed word");
  await act(async () => { await sleep(50); });
  eq(allowanceCalls > callsBefore, true, "arama sonrası hak yeniden okunmalı");
  eq(/0 \/ 150/.test(text()), true, "hak bitince 0 görünmeli");
  globalThis.__api = lastApi;
  console.log("18 kalan araştırma hakkı gösterilir ve arama sonrası güncellenir OK");
}

console.log("PANEL DAVRANIŞ TESTLERİ GEÇTİ");
process.exit(0);

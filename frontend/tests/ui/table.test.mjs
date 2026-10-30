// Keşfet tablosunun saf mantığı: süzme, sıralama, kelime grupları, fırsat oranı, CSV.
import { applyFilters, sortItems, wordGroups, toCsv, opportunity, variantKey, collapseVariants, EMPTY_FILTERS } from "../../src/components/discover/table.ts";

const item = (term, volume, extra = {}) => ({ term, demand: null, volume, cpc: null, competition: null, difficulty: null, monthly: [], trend_pct: null, intent: null, crowded: false, mine: false, saved: false, ...extra });
const items = [item("metal wall art", 12100), item("outdoor metal wall art", 2900, { intent: "commercial" }), item("large metal wall art", 1900, { mine: true }), item("how to hang metal wall art", 210), item("metal art for walls", null), item("large outdoor metal wall art", 1000)];
let failed = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { failed++; console.log("HATA", m, "\n  gelen:", JSON.stringify(a), "\n  beklenen:", JSON.stringify(b)); } };
const terms = (l) => l.map((i) => i.term);

eq(terms(applyFilters(items, { ...EMPTY_FILTERS, include: "outdoor large" })), ["large outdoor metal wall art"], "içerir (hepsi)");
eq(applyFilters(items, { ...EMPTY_FILTERS, exclude: "outdoor how" }).length, 3, "içermez");
eq(terms(applyFilters(items, { ...EMPTY_FILTERS, minVolume: "1500" })), ["metal wall art", "outdoor metal wall art", "large metal wall art"], "min hacim (hacmi olmayan elenir)");
eq(terms(applyFilters(items, { ...EMPTY_FILTERS, maxVolume: "1000" })), ["how to hang metal wall art", "metal art for walls", "large outdoor metal wall art"], "max hacim");
eq(terms(applyFilters(items, { ...EMPTY_FILTERS, intent: "commercial" })), ["outdoor metal wall art"], "niyet");
eq(applyFilters(items, { ...EMPTY_FILTERS, hideMine: true }).some((i) => i.mine), false, "sendekileri gizle");
eq(terms(applyFilters(items, { ...EMPTY_FILTERS, words: ["large", "outdoor"] })).sort(), ["large metal wall art", "large outdoor metal wall art", "outdoor metal wall art"], "kelime grupları: birleşim (VEYA)");
eq(terms(sortItems(items, { key: "volume", dir: "desc" }, {})).slice(0, 3), ["metal wall art", "outdoor metal wall art", "large metal wall art"], "hacme göre azalan");
eq(terms(sortItems(items, { key: "volume", dir: "asc" }, {}))[0], "how to hang metal wall art", "artan");
eq(terms(sortItems(items, { key: "volume", dir: "asc" }, {})).at(-1), "metal art for walls", "boş değer sonda (artan)");
eq(terms(sortItems(items, { key: "volume", dir: "desc" }, {})).at(-1), "metal art for walls", "boş değer sonda (azalan)");
eq(terms(sortItems(items, { key: "etsy", dir: "asc" }, { "metal wall art": 50, "large metal wall art": 10 })).slice(0, 2), ["large metal wall art", "metal wall art"], "Etsy ilan sayısına göre");
eq(terms(sortItems([item("a", 1, { difficulty: 20 }), item("b", 1, { difficulty: 70 }), item("c", 1)], { key: "difficulty", dir: "desc" }, {})), ["b", "a", "c"], "zorluğa göre; ölçülmemiş sonda");
eq(terms(sortItems([item("a", 1, { difficulty: 20 }), { ...item("old", 1), difficulty: undefined }], { key: "difficulty", dir: "desc" }, {})), ["a", "old"], "eski yanıtta zorluk alanı yok: çökmez, sonda");
eq(wordGroups(items, "metal wall art").slice(0, 2), [{ word: "large", count: 2 }, { word: "outdoor", count: 2 }], "kelime grupları (tohum kelimeleri hariç)");
eq(opportunity(1000, 50), 20, "fırsat"); eq(opportunity(null, 5), null, "fırsat yok"); eq(opportunity(100, 0), null, "ilan yok");
eq(toCsv([item('say "x", y', 5, { cpc: 0.5, competition: 20, difficulty: 35, trend_pct: -3, intent: "commercial" })], { 'say "x", y': 7 }).split("\r\n")[1], '"say ""x"", y",5,0.5,20,35,-3,commercial,7', "CSV kaçışı");
// varyantlar: kelime sırası, çoğul, bağlaçlar ve tekrar eden kelime aynı aramadır
eq(variantKey("art metal wall"), variantKey("metal wall art"), "kelime sırası");
eq(variantKey("metal art for the wall"), variantKey("metal wall art"), "bağlaçlar");
eq(variantKey("metal wall art for walls"), variantKey("metal wall art"), "çoğul");
eq(variantKey("metal metal wall art"), variantKey("metal wall art"), "tekrar eden kelime");
eq(variantKey("outdoor metal wall art") === variantKey("metal wall art"), false, "farklı anlam ayrı kalır");
eq(variantKey("glass sign") === variantKey("glas sign"), false, "'ss' ile biten kelime çoğul sayılmaz");
const dup = [item("art metal wall", 18100), item("metal art for the wall", 18100), item("metal wall art", 18100), item("outdoor metal wall art", 2900)];
const rowsC = collapseVariants(dup);
eq(rowsC.length, 2, "iki grup"); eq(rowsC[0].item.term, "art metal wall", "aynı hacimde en kısa, sonra ilk"); eq(rowsC[0].variants.length, 2, "iki varyant");
eq(collapseVariants([item("metal art for the wall", 18100), item("metal wall art", 18100)])[0].item.term, "metal wall art", "aynı hacimde kısa olan temsilci");
eq(collapseVariants([item("metal wall art", 18100), item("metal art wall", 90)])[0].item.term, "metal wall art", "farklı hacimde ilk (yüksek) kalır");
if (failed) { console.log(failed + " HATA"); process.exit(1); }
console.log("table.test OK");

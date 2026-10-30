// Yönetim > Araştırma: süzgeç -> sorgu/gövde dönüşümü ve dosyadan kelime okuma (saf mantık).
import { EMPTY_KEYWORD_FILTERS, advancedFilterCount, filterBody, filterQuery } from "../../src/lib/researchFilters.ts";
import { termsFromText } from "../../src/components/admin/research/terms.ts";

let failed = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { failed++; console.log("HATA", m, "\n  gelen:", JSON.stringify(a), "\n  beklenen:", JSON.stringify(b)); } };

// boş süzgeç hiçbir parametre göndermez; dolu olanlar tam olarak gider
eq(filterQuery(EMPTY_KEYWORD_FILTERS), "", "boş süzgeç");
eq(filterQuery({ ...EMPTY_KEYWORD_FILTERS, q: "metal sign", minVolume: "300", pinned: "yes", etsy: true }, { sort: "volume", page: "2" }), "sort=volume&page=2&q=metal+sign&etsy=true&pinned=yes&min_volume=300", "dolu süzgeç");
eq(filterQuery({ ...EMPTY_KEYWORD_FILTERS, minVolume: "0" }), "min_volume=0", "sıfır geçerli bir sayıdır, boş değildir");
eq(filterBody({ ...EMPTY_KEYWORD_FILTERS, expiringDays: "7", maxVolume: "" }).expiring_days, 7, "metin sayıya çevrilir");
eq(filterBody(EMPTY_KEYWORD_FILTERS).max_volume, null, "boş sayı null gider");

// gelişmiş süzgeç sayacı: arama ve durum hızlı çubukta olduğu için sayılmaz
eq(advancedFilterCount({ ...EMPTY_KEYWORD_FILTERS, q: "x", state: "stale", status: "blocked" }), 0, "hızlı süzgeçler sayılmaz");
eq(advancedFilterCount({ ...EMPTY_KEYWORD_FILTERS, source: "admin", etsy: true, unusedDays: "90" }), 3, "gelişmiş süzgeçler sayılır");

// dosyadan kelime: başlık atlanır, tırnaklı hücre ve ilk sütun okunur, boş satırlar düşer
eq(termsFromText("term,language,market\r\nmetal sign,en,US\r\n\r\n\"say \"\"x\"\", y\",en,US\r\n"), ["metal sign", 'say "x", y'], "dışa aktarılan CSV geri yüklenir");
eq(termsFromText("keyword\nalpha\nbeta"), ["alpha", "beta"], "başlık satırı atlanır");
eq(termsFromText("alpha\nkeyword\nbeta"), ["alpha", "keyword", "beta"], "yalnızca ilk satırdaki başlık atlanır");
eq(termsFromText("  \n\n"), [], "boş dosya");

if (failed) { console.log(failed + " HATA"); process.exit(1); }
console.log("pool-admin.test OK");

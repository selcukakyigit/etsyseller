// Yeni listing yayınlanınca iş durumu gerçek kimliğe taşınır (eski negatif kimlikte kalırsa ilerleme çubuğu kaybolur, hata görünmez).
import { publishedId } from "../../src/lib/publishId.ts";

const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
eq(publishedId(-1793095730, { listing_id: 4604118656 }), 4604118656, "yeni listing: gerçek kimlik");
eq(publishedId(-5, {}), -5, "kimlik dönmediyse (Etsy'ye hiç gitmedi) eski kimlik");
eq(publishedId(-5, { listing_id: null }), -5, "null ise eski kimlik");
eq(publishedId(982333846, { listing_id: 982333846 }), 982333846, "var olan listing: aynı kimlik");
eq(publishedId(982333846, { listing_id: 111 }), 982333846, "var olan listing'in kimliği değişmez");
console.log("YAYIN KİMLİĞİ TESTLERİ GEÇTİ");
process.exit(0);

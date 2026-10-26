// Etsy yazma kuralları (backend etsy_rules'tan gelen kümeler) formda girişte uygulanır: etiket/materyal/başlık temizleme ve başlık uyarısı.
const { cleanTag, cleanWord, cleanTitle, titleProblem } = await import("../../src/lib/etsyRules.ts");

// backend/app/listings/etsy_rules.py rules_for_client() çıktısıyla aynı
const rules = {
  title: { max_len: 140, allowed: String.raw`\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®`, once_only: "%:&+" },
  tag: { max_count: 13, max_len: 20, allowed: String.raw`\p{L}\p{Nd}\p{Zs}\-'™©®` },
  material: { max_count: 13, allowed: String.raw`\p{L}\p{Nd}\p{Zs}` },
  style: { max_count: 2, max_len: 45, allowed: String.raw`\p{L}\p{Nd}\p{Zs}` },
  alt_text_max: 500,
};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}\n  gelen: ${JSON.stringify(a)}\n  beklenen: ${JSON.stringify(b)}`); };
const t = (tr) => tr;

eq(cleanTag("metal sign!", rules), "metal sign", "etiketten ünlem çıkar");
eq(cleanTag("powder/coated  door-sign", rules), "powder coated door-sign", "eğik çizgi boşluk olur, tire kalır");
eq(cleanTag("dad’s garage", rules), "dad's garage", "tipografik kesme işareti düzelir");
eq(cleanWord("powder-coated metal", rules, "material"), "powder coated metal", "materyalde tire yok");
eq(cleanWord("2 mm.", rules, "material"), "2 mm", "materyalde nokta yok");
eq(cleanWord("dad's", rules, "style"), "dads", "stilde kesme işareti silinir");
eq(cleanTitle("Address Planter Box: Metal Sign: Large", rules), "Address Planter Box: Metal Sign Large", "başlıkta : yalnızca bir kez");
eq(cleanTitle("Sign ★ Metal ✓ ™", rules), "Sign Metal ™", "simge çıkar, ™ kalır");
eq(titleProblem("Fine title: ok", rules, t), null, "temiz başlıkta uyarı yok");
eq(typeof titleProblem("A & B & C", rules, t), "string", "tekrarlanan & uyarı verir");
eq(titleProblem("x".repeat(141), rules, t).includes("140"), true, "uzun başlık uyarısı sınırı söyler");
console.log("etsyRules OK");

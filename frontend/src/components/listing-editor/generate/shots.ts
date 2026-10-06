// Etsy'nin önerdiği ürün fotoğrafı çeşitliliği (kapak/açı/detay/ölçek/yaşam tarzı/uzak-yakın çekim). Seçilen adette bu
// çeşitlilikte bir set üretilir; 8'den fazlasında çekimler varyasyon olarak tekrar eder.
// Komutlar görsel modeline gider ve arayüz dilinden bağımsız olarak İngilizcedir; etiketler iki dillidir.
export const SHOT_PRESETS: { label: [string, string]; prompt: string }[] = [
  { label: ["Ana fotoğraf (kapak)", "Main photo (cover)"], prompt: "Show the product on a plain, neutral, clean background, straight from the front, centered, balanced and well lit, in sharp focus. This will be the featured cover photo on Etsy." },
  { label: ["Farklı açı (3/4)", "Different angle (3/4)"], prompt: "Show the same product from a 3/4 angle (slightly from the side); keep the lighting and background consistent." },
  { label: ["Yakın çekim / detay", "Close-up / detail"], prompt: "Show the product's texture, material and craftsmanship in a very close macro shot." },
  { label: ["Ölçek referansı", "Scale reference"], prompt: "Show the product held in a hand or next to an everyday object so its real size is clear." },
  { label: ["Yaşam tarzı (kullanımda)", "Lifestyle (in use)"], prompt: "Show the product in a real setting, in a natural lifestyle scene, being used or displayed." },
  { label: ["Uzak çekim / geniş kadraj", "Wide shot"], prompt: "Show the product from a distance in a wide frame together with its surroundings." },
  { label: ["Arka/üst görünüm", "Back / top view"], prompt: "Show the back of the product or a view from above." },
  { label: ["Alternatif sahne", "Alternative scene"], prompt: "Show the same product on a different surface or decor scene." },
];

/** Ürün turunun adımları. `target`: ekrandaki `data-tour="…"` işaretli öğenin adı (kenar çubuğu bağlantıları `nav:/yol`). İşaretli öğe görünür değilse
 * (telefon, mağazasız menü) adım ortada bir kart olarak gösterilir, tur yine anlamlı kalır. Metinler [başlık, açıklama] çiftleridir. */
export type TourStep = { id: string; target?: string; tr: [string, string]; en: [string, string] };

export const MAIN_TOUR: TourStep[] = [
  {
    id: "welcome",
    tr: ["Ulagg'a hoş geldin", "Bir dakikalık turda neyin nerede olduğunu gösterelim. Gördüğün her şey örnek veridir; istediğin gibi dene, Etsy'ye hiçbir şey gönderilmez."],
    en: ["Welcome to Ulagg", "A one-minute tour of what is where. Everything you see is sample data, so try anything: nothing is ever sent to Etsy."],
  },
  {
    id: "assistant",
    target: "nav:/dashboard",
    tr: ["Asistan", "Mağazan hakkında düz cümlelerle sor: \"Bu ay en çok ne sattı?\", \"Hangi ilanın başlığı zayıf?\". Değişiklik önerir ama sen onaylamadan hiçbir şey yayınlamaz."],
    en: ["Assistant", "Ask about your shop in plain words: \"What sold best this month?\", \"Which listing has a weak title?\". It suggests changes but never publishes without your approval."],
  },
  {
    id: "analysis",
    target: "nav:/analysis",
    tr: ["Analiz", "Mağazanın nerede iyi, nerede zayıf olduğunu gösterir: görüntülenme, favori, satış ve neyi değiştirince ne olduğu."],
    en: ["Analysis", "Shows where your shop is strong and where it is weak: views, favorites, sales, and what happened after each change."],
  },
  {
    id: "listings",
    target: "nav:/listings",
    tr: ["Listing'ler", "Her ilanın sağlığını gör, yapay zekâ önerileriyle taslak hazırla, fotoğraf ve açıklamayı düzenle. Etsy'ye yalnızca \"Yayınla\" dediğinde gider."],
    en: ["Listings", "See each listing's health, prepare drafts with AI suggestions, edit photos and descriptions. Changes only reach Etsy when you press Publish."],
  },
  {
    id: "discover",
    target: "nav:/discover",
    tr: ["Keşfet", "Anahtar kelime araştırması: aranma düzeyi, rekabet ve mevsim. Veriler Google'a aittir, Etsy arama hacmi değildir."],
    en: ["Discover", "Keyword research: search level, competition and seasonality. The figures are Google data, not Etsy search volume."],
  },
  {
    id: "orders",
    target: "nav:/orders",
    tr: ["Siparişler", "Gönderim tarihine göre sıralı siparişler, kişiselleştirme notları, takip numaraları ve gecikme uyarıları."],
    en: ["Orders", "Orders sorted by ship-by date, personalization notes, tracking numbers and late-shipment warnings."],
  },
  {
    id: "finance",
    target: "nav:/finance",
    tr: ["Finans", "Etsy ücretleri, kargo ve ürün maliyeti düşüldükten sonra gerçek kârın. Ürün, ülke ve müşteri bazında; maliyetleri buradan girersin."],
    en: ["Finance", "Your real profit after Etsy fees, shipping and product costs, by product, country and customer. You enter your costs here."],
  },
  {
    id: "credits",
    target: "credits",
    tr: ["Krediler", "Yapay zekâ işlemleri kredi harcar. Abonelik yok; görsel ve video fiyatı üretmeden önce gösterilir. Bakiyen ve geçmişin burada."],
    en: ["Credits", "AI actions use credits. There is no subscription, and image and video prices are shown before you generate. Your balance and history live here."],
  },
  {
    id: "help",
    target: "nav:/support",
    tr: ["Yardım ve destek", "Takıldığında buradan yaz; bu turu istediğin zaman buradan yeniden başlatabilirsin."],
    en: ["Help and support", "Write to us here whenever you get stuck. You can also replay this tour from here at any time."],
  },
  {
    id: "connect",
    tr: ["Hazır olunca gerçek mağazanı bağla", "Etsy'yi bağladığında örnek veri kendiliğinden kalkar ve buradaki her şey kendi mağazanın verisiyle çalışır. Şifreni hiç görmeyiz; bağlantı Etsy'nin kendi izin ekranından kurulur."],
    en: ["Connect your real shop when you are ready", "Once you connect Etsy the sample data disappears and everything here runs on your own shop. We never see your password: the connection uses Etsy's own authorization screen."],
  },
];

/** Örnek mağazadaki kullanıcıya "her şey örnek veri" ve "gerçek mağazanı bağla" adımları gösterilir; gerçek mağazalı kullanıcıya gösterilmez. */
export function mainTour(sample: boolean): TourStep[] {
  if (sample) return MAIN_TOUR;
  return MAIN_TOUR.filter((s) => s.id !== "connect").map((s) =>
    s.id === "welcome"
      ? {
          ...s,
          tr: ["Ulagg'a hoş geldin", "Bir dakikalık turda neyin nerede olduğunu gösterelim. Etsy'ye yalnızca senin onayınla bir şey yazılır."],
          en: ["Welcome to Ulagg", "A one-minute tour of what is where. Nothing is written to Etsy without your approval."],
        }
      : s,
  );
}

const key = (userId: number) => `ulagg.tour.v1.${userId}`;

/** Turu bu kullanıcı bu tarayıcıda gördü mü? (Yalnızca kolaylık: depolama kapalıysa tur her seferinde önerilir.) */
export function tourSeen(userId: number): boolean {
  try {
    return window.localStorage.getItem(key(userId)) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(userId: number): void {
  try {
    window.localStorage.setItem(key(userId), "1");
  } catch {}
}

/** Turu istediğin yerden (destek sayfası, örnek mağaza bandı) yeniden başlatır; AppShell dinler. */
export function startTour(): void {
  window.dispatchEvent(new Event("ulagg:start-tour"));
}

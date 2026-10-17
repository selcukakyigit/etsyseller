"""Listing içerik standardı: başlık / etiket / açıklama kurallarının TEK kaynağı.

Sayılar (kelime sınırı, etiket sayısı…) burada tanımlanır; denetimler (`quality`, `audit`), SEO öneri istemi (`seo`) ve sohbet asistanının istemi
metni buradan alır. Kural değişince yalnızca bu dosya değişir.

Kaynaklar: Etsy'nin Ağustos 2025 başlık rehberi (kısa, net, nesnel; hediye/öznel sözcük/kargo bilgisi yok), Etsy aramasının başlık, etiket, açıklama,
kategori ve özellikleri birlikte eşleştirmesi (Seller Handbook "Keywords 101"), alıcı niyetini anlayan dil modelli arama. Yapay zekâ alışveriş
asistanları (ChatGPT, Google AI) de aynı şeyi okur: net, olgusal, tutarlı ve eksiksiz bir listing. Etsy'nin yapay zekâ aramasına özel resmî bir kuralı yoktur;
açıklamadaki yapı (açılış cümlesi, olgu listesi, soru-cevap) topluluk kaynaklarındaki ortak bulgulara dayanır."""

TITLE_MAX_CHARS = 140  # Etsy sınırı
TITLE_MAX_WORDS = 15  # Etsy rehberi: "15 kelimeden az"
TITLE_MIN_CHARS = 20
TITLE_LEAD_CHARS = 40  # ana arama öbeği bu sınırın içinde başlar
TAG_COUNT = 13
TAG_MAX_LEN = 20
MAX_SHARED_TAGS = 5  # başka tek bir listing'le en fazla bu kadar aynı etiket
OPENING_CHARS = 160  # arama sonucu önizlemesi ve yapay zekâ özetleri açıklamanın başını okur
DESCRIPTION_WORDS = (200, 300)  # ürüne özel kısım (mağazanın sabit bölümleri hariç)
FAQ_COUNT = (3, 4)

TITLE_RULES = (
    f"KISA ve NET: {TITLE_MAX_WORDS} kelimeden az. Önce ürünün NE olduğu (ana arama öbeği ilk {TITLE_LEAD_CHARS} karakterde), sonra renk, malzeme, stil gibi NESNEL tanımlar.",
    "Başlıkta OLMAYACAKLAR: hediye/alıcı ifadeleri (\"gift for dad\", \"for her\"), öznel sözcükler (\"beautiful\", \"perfect\", \"best\"), kargo/indirim bilgisi, aynı kelimenin tekrarı, virgülle sıralanmış kelime listesi.",
    "Başlıktan çıkardığın hediye/alıcı/kullanım yeri/vesile ifadelerini SİLME: etiketlere ve açıklamaya taşı (Etsy bunları oralardan da okur).",
    "Ölçü başlıkta yalnızca tek, sabit ölçülü üründe durur (\"11 oz mug\"); birden çok ölçü ya da renk seçeneği varsa başlığa tek bir seçenek yazma, seçenekler varyasyonlarda ve açıklamada durur.",
    "Listing'de olmayan ölçü, renk ya da malzeme ASLA uydurma (başlıkta da açıklamada da).",
)

TAG_RULES = (
    f"Tam {TAG_COUNT} etiket, her biri en fazla {TAG_MAX_LEN} karakter, çoğu 2–4 kelimelik uzun kuyruklu ifade.",
    "Başlıkla ve birbiriyle gereksiz tekrar etmesin; tekil/çoğul, eş anlamlı ve alıcı niyeti (kim için, hangi vesile, hangi kullanım, hangi stil) ile kapsamı genişlet.",
    "Renk listesi etiketi yazma (renkler varyasyonda zaten var); marka ya da karakter adı yazma.",
)

DESCRIPTION_RULES = (
    f"Yalnızca ürüne özel kısmı yaz ({DESCRIPTION_WORDS[0]}–{DESCRIPTION_WORDS[1]} kelime). Mağazanın sabit bölümleri (kargo, iade, iletişim, yasal) otomatik eklenir ya da olduğu gibi korunur; yazma, değiştirme.",
    f"AÇILIŞ (ilk {OPENING_CHARS} karakter): tek net cümlede ürünün ne olduğunu, kim/ne için olduğunu ve en önemli özelliğini (malzeme, ölçü) söyle; ana aranan ifadeler doğal geçsin. Selamlama, \"welcome\", abartı yok.",
    "OLGULAR: malzeme, ölçüler/seçenekler (varyasyonlardaki TÜM seçenekler), kişiselleştirme nasıl yapılır, pakette ne var, bakım. Kısa maddeler halinde, yalnızca bildiğin bilgiler.",
    "KULLANIM VE VESİLE: kime, hangi anda, hangi ihtiyaç için (hediye vesileleri burada); alıcının doğal dille soracağı gibi yaz.",
    f"SORU-CEVAP ({FAQ_COUNT[0]}–{FAQ_COUNT[1]} kısa): \"Q: …\" / \"A: …\" biçiminde, yalnızca listing verisinden cevaplanabilen sorular (ölçü seçenekleri, malzeme, kişiselleştirme, hazırlık/kargo bilgisi). Cevabını bilmediğin soruyu yazma; veri yetmiyorsa bu bölümü atla.",
    "Doğrulanamayan iddia (waterproof, lifetime, certified…) ve öznel övgü yazma; somut ve ölçülebilir ifadeleri tercih et.",
)


def bullets(rules: tuple[str, ...]) -> str:
    return "\n".join(f"- {r}" for r in rules)


def prompt_block() -> str:
    """Modele giden standart: SEO öneri istemi ve sohbet asistanı aynı metni kullanır."""
    return f"BAŞLIK:\n{bullets(TITLE_RULES)}\n\nETİKETLER:\n{bullets(TAG_RULES)}\n\nAÇIKLAMA:\n{bullets(DESCRIPTION_RULES)}"

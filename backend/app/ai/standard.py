"""Listing içerik standardı: başlık / etiket / açıklama kurallarının TEK kaynağı.

Sayılar (kelime sınırı, etiket sayısı…) burada tanımlanır; denetimler (`quality`, `audit`), SEO öneri istemi (`seo`) ve sohbet asistanının istemi
metni buradan alır. Kural değişince yalnızca bu dosya değişir.

Kaynaklar: Etsy'nin Ağustos 2025 başlık rehberi (kısa, net, nesnel; hediye/öznel sözcük/kargo bilgisi yok), Etsy aramasının başlık, etiket, açıklama,
kategori ve özellikleri birlikte eşleştirmesi (Seller Handbook "Keywords 101"), alıcı niyetini anlayan dil modelli arama. Yapay zekâ alışveriş
asistanları (ChatGPT, Google AI) de aynı şeyi okur: net, olgusal, tutarlı ve eksiksiz bir listing. Etsy'nin yapay zekâ aramasına özel resmî bir kuralı yoktur;
açıklamadaki yapı (açılış cümlesi, olgu listesi, soru-cevap) topluluk kaynaklarındaki ortak bulgulara dayanır."""

TITLE_MAX_CHARS = 140  # Etsy sınırı
TITLE_MAX_WORDS = 14  # Etsy (Ağustos 2025): "15 kelimenin altı"; uzun kuyruk etiketlere, özelliklere ve açıklamaya gider
TITLE_TARGET_CHARS = (50, 110)  # açılış ifadesi + 2-3 nesnel niteleyici bu aralığa düşer (yayın öncesi kontrol de bunu kullanır)
TITLE_MIN_CHARS = 20
TITLE_LEAD_CHARS = 40  # ana arama öbeği bu sınırın içinde başlar
TAG_COUNT = 13
TAG_MAX_LEN = 20
MAX_SHARED_TAGS = 5  # başka tek bir listing'le en fazla bu kadar aynı etiket
OPENING_CHARS = 160  # arama sonucu önizlemesi ve yapay zekâ özetleri açıklamanın başını okur
DESCRIPTION_WORDS = (80, 200)  # ürüne özel kısım (mağazanın sabit bölümleri hariç); veri azsa kısa kalabilir, doldurulmaz
FAQ_COUNT = (2, 3)  # isteğe bağlı: yalnızca yeni bilgi veriyorsa

TITLE_RULES = (
    f"KISA ve NET: en çok {TITLE_MAX_WORDS} kelime (Etsy: 15 kelimenin altı), çoğu {TITLE_TARGET_CHARS[0]}–{TITLE_TARGET_CHARS[1]} karakter. Önce ürünün NE olduğu (ana arama öbeği ilk {TITLE_LEAD_CHARS} karakterde, bir kez), sonra en önemli 2-3 NESNEL tanım: malzeme, renk/ölçü yalnızca tek seçenekse, stil ya da kişiselleştirme. Uzun kuyruk ifadeler etiketlere, özelliklere ve açıklamaya gider. Okunur bir ifade olsun, virgüllü kelime yığını değil.",
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

LAYOUT_RULES = (
    "DÜZEN (düz metin): açılış paragrafı, sonra bölümler; her bölüm arasında bir boş satır. Bölüm başlığı kendi satırında BÜYÜK HARF ve emojisiz (DETAILS, GREAT FOR, QUESTIONS).",
    "Maddeler tek tip \"• \" ile, her madde tek satır; paragraf en fazla 3 satır; soru-cevap çiftleri arasında boş satır. Emoji kullanma. Mağazanın sabit bölümleri kendi sembolleriyle aynen kalır.",
)

DESCRIPTION_RULES = (
    f"Yalnızca ürüne özel kısmı yaz (yaklaşık {DESCRIPTION_WORDS[0]}–{DESCRIPTION_WORDS[1]} kelime). Mağazanın sabit bölümleri (kargo, iade, iletişim, yasal) otomatik eklenir ya da olduğu gibi korunur; yazma, değiştirme.",
    "NİYET ÖNCE: açıklama alıcının \"bu ne, kime/nereye uyar, neden bunu alayım\" sorusunu cevaplasın. Uzunluk hedef değildir: eldeki bilgi azsa kısa ve doğru yaz, dolgu ya da uydurma ile uzatma. Mevcut açılış cümlesi zaten ürünü, kullanım yerini ve ana özelliğini anlatıyorsa onu OLDUĞU GİBİ koru, yeniden yazıp şişirme. Kullanıcı (ya da talimat) ek bilgi verdiyse bunu ilgili yere ekle.",
    "Fotoğraf ve başlıktan anlaşılan niyet bilgisi (oda, tarz, tema, vesile, kimler için) serbestçe yazılabilir; ölçü, malzeme, dayanıklılık gibi olgular ise yalnızca verilen veriden ya da fotoğrafta açıkça görünenden gelir.",
    f"AÇILIŞ (ilk {OPENING_CHARS} karakter): tek net cümlede ürünün ne olduğunu, kim/ne için olduğunu ve en önemli özelliğini (malzeme, ölçü) söyle; ana aranan ifadeler doğal geçsin. Selamlama, \"welcome\", abartı yok.",
    "OLGULAR (DETAILS, kısa maddeler): malzeme, ölçüler/seçenekler (varyasyonlardaki TÜM seçenekleri ADIYLA say: \"Sizes: 50 cm, 70 cm\"), kişiselleştirme nasıl yapılır, pakette ne var, bakım. Dijital üründe: dosya türü, çözünürlük/boyut, kaç dosya, nasıl indirilip kullanılır, kullanım hakkı. Yalnızca bildiğin bilgiler.",
    "HER BİLGİ BİR KEZ: ölçü, kişiselleştirme, malzeme yalnızca OLGULAR'da geçer; açılışta kısaca anılabilir ama GREAT FOR ve soru-cevapta TEKRAR EDİLMEZ. Dolgu cümle yazma (\"see variations\", \"options are set as variations\", \"choose from the size menu\", \"prices are listed in the variations\"): seçenekleri adıyla yaz.",
    "GREAT FOR (1–3 madde, isteğe bağlı): yalnızca aramada niyet yakalayan bilgi (oda, vesile, mevsim, alıcı); OLGULAR'daki bilgiyi tekrar etme; yeni bir şey katmıyorsa bu bölümü atla.",
    f"SORU-CEVAP (fiziksel üründe BEKLENİR, en fazla {FAQ_COUNT[1]}; dijital ya da çok basit üründe atlanabilir): alıcının satın almadan önce gerçekten soracağı, OLGULAR'da cevabı olmayan sorular. Ürün tipine göre tipik konular: dayanıklılık/pas ve yüzey (metalde \"Will it rust?\"), malzeme ve yüzey işlemi, montaj/asma (hangi duvara, ne ile, ne gönderilir), taşıma kapasitesi, iç/dış mekân, bakım, kişiselleştirmede yazı sınırı ve süre. Cevap YALNIZCA bilinen olgudan gelir (kullanıcının söylediği, varyasyon/özellik verisi, fotoğrafta görünen); cevabını bilmediğin kritik bilgiyi (malzeme, yüzey/boya, taşıma kapasitesi) UYDURMA: sohbette kullanıcıya tek kısa soru olarak sor. Kullanıcı bilmiyor/\"sen karar ver\" derse iddia içeren soruyu yazma, yalnızca bilinen konulardan yaz. OLGULAR'da yazılan bilgiyi soru yapma. Yazacak gerçek soru yoksa bölümü hiç ekleme; \"No questions\" gibi boş bölüm ASLA yazılmaz.",
    "OLMAYAN bilgiyi yazma: \"Personalization: none\", \"Not included\", \"No questions\" gibi \"yok\" satırları ve boş bölümler ASLA yazılmaz; ürün kişiselleştirilemiyorsa kişiselleştirmeden hiç söz etme, soru-cevap yoksa QUESTIONS bölümünü hiç ekleme.",
    "Doğrulanamayan iddia (waterproof, lifetime, certified…) ve öznel övgü yazma; somut ve ölçülebilir ifadeleri tercih et.",
    *LAYOUT_RULES,
)


def bullets(rules: tuple[str, ...]) -> str:
    return "\n".join(f"- {r}" for r in rules)


def prompt_block() -> str:
    """Modele giden standart: SEO öneri istemi ve sohbet asistanı aynı metni kullanır."""
    return f"BAŞLIK:\n{bullets(TITLE_RULES)}\n\nETİKETLER:\n{bullets(TAG_RULES)}\n\nAÇIKLAMA:\n{bullets(DESCRIPTION_RULES)}"

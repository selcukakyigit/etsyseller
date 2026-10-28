"""Asistan çalışırken gösterilen sade, teknik olmayan adım yazıları.

Tek satırlık `TOOL_LABELS` yerine, gerçekten birkaç aşaması olan araçlar için sıralı adımlar yazılır; istemci bunları okunabilir bir
hızla sırayla gösterir. Metinler aracın gerçekten yaptığı işi anlatır (uydurma adım yok). Her adım (Türkçe, İngilizce) çiftidir."""
import html
import json
import random

from sqlalchemy import select
from sqlalchemy.orm import Session

TITLE_MAX = 42

# {t}: listing başlığı (biliniyorsa); başlık yoksa `_PLAIN` karşılığı kullanılır.
_TITLED: dict[str, list[tuple[str, str]]] = {
    "get_listing": [("“{t}” listing'ini okuyor", "Reading the “{t}” listing")],
    "listing_diagnosis": [
        ("“{t}” için satış geçmişine bakıyor", "Looking at the sales history of “{t}”"),
        ("Son aylardaki satışları önceki aylarla karşılaştırıyor", "Comparing recent months with earlier months"),
        ("Görüntülenme, favori ve satış oranlarını tartıyor", "Weighing views, favorites and sales"),
        ("Mevsimin etkisi olup olmadığını kontrol ediyor", "Checking whether the season is playing a part"),
        ("Geçmişte yaptığın değişikliklerle karşılaştırıyor", "Comparing with the changes you made before"),
        ("En olası nedeni ve tek bir hamleyi belirliyor", "Picking the most likely cause and one next move"),
    ],
    "listing_performance": [
        ("“{t}” için seçilen dönemin satışlarına bakıyor", "Looking at sales of “{t}” for the chosen period"),
        ("Bir önceki dönemle karşılaştırıyor", "Comparing with the previous period"),
        ("İçeriğin ne kadar eski olduğunu kontrol ediyor", "Checking how old the content is"),
    ],
    "listing_health_status": [
        ("“{t}” içeriğini kontrol ediyor", "Checking the content of “{t}”"),
        ("Satış performansına bakıyor", "Looking at sales performance"),
        ("Şimdi dokunma zamanı gelip gelmediğine karar veriyor", "Deciding whether it is time to touch it"),
    ],
    "autofill_listing_attributes": [
        ("Kategorinin istediği özellikleri okuyor", "Reading the attributes the category asks for"),
        ("“{t}” fotoğraflarına ve metnine bakıyor", "Looking at the photos and text of “{t}”"),
        ("Boş özellikleri dolduruyor", "Filling in the empty attributes"),
    ],
    "publish_listing_draft": [
        ("“{t}” değişikliklerini Etsy'deki hâliyle karşılaştırıyor", "Comparing your changes to “{t}” with what is on Etsy"),
        ("Değişiklikleri Etsy'ye gönderiyor", "Sending the changes to Etsy"),
        ("Her şeyin doğru gittiğini kontrol ediyor", "Checking that everything went through"),
    ],
}

_PLAIN: dict[str, list[tuple[str, str]]] = {
    "similar_listings": [
        ("Mağazandaki benzer ürünleri arıyor", "Looking for similar products in your shop"),
        ("Fiyat, etiket ve başlık üslubunu karşılaştırıyor", "Comparing price, tags and title style"),
    ],
    "finance_summary": [
        ("Satışları ve giderleri topluyor", "Adding up sales and expenses"),
        ("Kâr hesabını çıkarıyor", "Working out the profit"),
    ],
    "monthly_pnl": [
        ("Ay ay satışları ve giderleri topluyor", "Adding up sales and expenses month by month"),
        ("Aylık kâr-zarar tablosunu hazırlıyor", "Building the monthly profit and loss table"),
    ],
    "get_category_attributes": [
        ("Kategorinin özelliklerini okuyor", "Reading the category attributes"),
        ("Hangilerinin zorunlu olduğuna bakıyor", "Checking which ones are required"),
    ],
}


# Yeni listing akışının adımları: her adım için birkaç söyleyiş, her seferinde rastgele biri seçilir (hep aynı cümleyi görmek sıkıyor). Teknik terim yok; hafif şakacı,
# ama aracın gerçekten yaptığı işi anlatır. [adım][söyleyiş] = (Türkçe, İngilizce)
_VARIED: dict[str, list[list[tuple[str, str]]]] = {
    "brief_check": [
        [("Fotoğrafa dikkatle bakıyor", "Taking a good look at the photo"), ("Fotoğrafı büyüteçle inceliyor", "Studying the photo with a magnifying glass"), ("Ürünün neye benzediğini çözüyor", "Working out what the product looks like")],
        [("Eksik bilgileri not alıyor", "Noting what is still missing"), ("Neyi sorması gerektiğini tartıyor", "Weighing what it should ask you"), ("Gözden kaçan bir şey var mı diye bakıyor", "Checking nothing slipped through")],
        [("Başlık fikirleri kafasında dönüyor", "Title ideas are spinning around"), ("Aranacak kelimeleri yan yana diziyor", "Lining up the words people search for"), ("Üç farklı başlık için kolları sıvıyor", "Rolling up sleeves for three different titles")],
    ],
    "create_listing_draft": [
        [("Verdiğin bilgileri masaya yayıyor", "Spreading your details on the table"), ("Notlarını toparlıyor", "Gathering up your notes"), ("Bilgileri düzene sokuyor", "Putting your details in order")],
        [("Başlığı, etiketleri ve açıklamayı yazıyor", "Writing the title, tags and description"), ("Alıcıya hitap eden bir açıklama kuruyor", "Building a description that talks to the buyer"), ("Kelimeleri tek tek yerine koyuyor", "Putting the words in place one by one")],
        [("Boyut ve renk seçeneklerini sıralıyor", "Lining up the sizes and colors"), ("Fiyat ve stok tablosunu dolduruyor", "Filling in the price and stock table"), ("Seçenekleri hizalıyor", "Straightening out the options")],
        [("Ürüne uygun rafı arıyor, yani kategoriyi", "Looking for the right shelf, meaning the category"), ("Kategoriler arasında doğru dalı buluyor", "Finding the right branch among the categories")],
        [("Son kontrol, virgüller yerinde mi", "Final check, are the commas in place"), ("Taslağı kaydediyor", "Saving the draft"), ("Taslağı çerçeveletiyor, neredeyse bitti", "Framing the draft, nearly there")],
    ],
    "keyword_pool": [
        [("Satış getiren etiketlere bakıyor", "Looking at the tags that bring sales"), ("Alıcıların ne aradığına kulak misafiri oluyor", "Eavesdropping on what buyers search for"), ("Etiketlerin arasında dolaşıyor", "Wandering through the tags")],
        [("Rakiplerin kelimelerine göz atıyor", "Glancing at the words competitors use"), ("Kalabalık ifadeleri eliyor", "Dropping the overcrowded phrases"), ("En işe yarar kelimeleri ayırıyor", "Picking out the most useful words")],
    ],
    "find_category": [
        [("Kategori ağacında doğru dalı arıyor", "Searching the category tree for the right branch"), ("Ürünün gideceği rafı arıyor", "Looking for the shelf this product belongs on")],
    ],
}

_THINKING = [
    ("Düşünüyor", "Thinking"), ("Bir bakıyor", "Taking a look"), ("Kafasında tartıyor", "Turning it over"), ("İşe koyuluyor", "Getting to it"), ("Not alıyor", "Taking notes"),
]


def thinking(en: bool) -> str:
    """İlk bekleme yazısı: her seferinde farklı bir söyleyiş."""
    tr_text, en_text = random.choice(_THINKING)
    return en_text if en else tr_text


def _title(db: Session, shop_id: int, args: dict) -> str | None:
    from app.listings.models import ListingCache

    try:
        lid = int(args.get("listing_id"))
    except (TypeError, ValueError):
        return None
    row = db.scalars(select(ListingCache).where(ListingCache.shop_id == shop_id, ListingCache.listing_id == lid)).first()
    if row is None:
        return None
    try:
        text = html.unescape(str(json.loads(row.raw_json).get("title") or "")).strip()
    except ValueError:
        return None
    return (text[: TITLE_MAX - 1].rstrip() + "…") if len(text) > TITLE_MAX else (text or None)


def steps_for(db: Session, shop_id: int, name: str, args: dict, en: bool) -> list[str]:
    """Aracın sıralı adım yazıları; tanımlı değilse boş liste (çağıran tek satırlık etikete döner)."""
    if name in _VARIED:
        return [(random.choice(step)[1 if en else 0]) for step in _VARIED[name]]
    if name in _TITLED:
        title = _title(db, shop_id, args)
        steps = _TITLED[name]
        if title is None:  # başlık bilinmiyorsa başlıklı adımlar yerine adı geçmeyenler kalır
            steps = [s for s in steps if "{t}" not in s[0]]
        return [(s[1] if en else s[0]).replace("{t}", title or "") for s in steps]
    return [s[1] if en else s[0] for s in _PLAIN.get(name, [])]

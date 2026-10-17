"""Pazar araştırması: Etsy'nin herkese açık arama verisiyle (rakip başlık, etiket, fiyat, popülerlik) listing yazmayı gerçek veriye dayandırır.
Etsy'ye mağaza yetkisiyle değil, uygulamanın kendi API anahtarıyla istek atar; mağaza verisine dokunmaz."""
import html
import statistics
from collections import Counter

from app.taxonomy import service as taxonomy_service

MAX_RESULTS = 50


def _price(item: dict) -> float | None:
    p = item.get("price") or {}
    return round(p["amount"] / p["divisor"], 2) if p.get("divisor") else None


def market_research(ctx, a: dict) -> dict:
    query = " ".join(str(a.get("query", "")).split())
    if not query:
        return {"error": "Arama ifadesi gerekli (İngilizce, ör. 'christmas t-shirt')."}
    try:
        data = taxonomy_service.search_active_listings(query, min(int(a.get("limit") or 40), MAX_RESULTS))
    except Exception as exc:  # noqa: BLE001 - Etsy erişilemezse kullanıcıya düz hata
        return {"error": f"Etsy aramasına ulaşılamadı: {str(exc)[:160]}"}
    items = data.get("results") or []
    if not items:
        return {"arama": query, "toplam_sonuc": data.get("count", 0), "not": "Sonuç yok; daha genel bir ifade dene."}
    prices = sorted(p for p in (_price(i) for i in items) if p)
    currency = (items[0].get("price") or {}).get("currency_code")
    tags = Counter(t.lower() for i in items for t in (i.get("tags") or []))
    popular = sorted(items, key=lambda i: (i.get("num_favorers") or 0, i.get("views") or 0), reverse=True)[:8]
    return {
        "arama": query, "toplam_sonuc": data.get("count"), "incelenen": len(items), "para_birimi": currency,
        "fiyat": {"en_dusuk": prices[0], "medyan": round(statistics.median(prices), 2), "en_yuksek": prices[-1]} if prices else None,
        "en_cok_kullanilan_etiketler": [{"etiket": t, "kac_listingde": n} for t, n in tags.most_common(25)],
        "en_populer_listingler": [
            {"baslik": html.unescape(i.get("title") or "")[:120], "fiyat": _price(i), "favori": i.get("num_favorers"), "goruntulenme": i.get("views"), "etiketler": (i.get("tags") or [])[:13]}
            for i in popular
        ],
        "not": "Bu veri herkese açık arama sonuçlarıdır (satış sayısı yok; favori/görüntülenme popülerlik göstergesidir). Başlık ve etiketi bunlardan KOPYALAMA; ortak kalıpları ve eksik kalan fırsatları kullan, kendi ürününe özgü yaz.",
    }


TOOLS: list[dict] = [
    {
        "name": "market_research",
        "description": "Etsy'de bir anahtar kelime için pazar araştırması: en çok kullanılan etiketler, fiyat aralığı (medyan), en popüler listing başlıkları. Yeni listing'de başlık/etiket/fiyatı gerçek veriye dayandırmak ya da 'şu üründe piyasa nasıl, kaça satılıyor, hangi etiketler popüler' soruları için. query İngilizce olmalı.",
        "input_schema": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "description": "En fazla 50 (varsayılan 40)"}}, "required": ["query"]},
    },
]
EXECUTORS = {"market_research": market_research}
LABELS = {"market_research": "Pazarı araştırıyor"}
LABELS_EN = {"market_research": "Researching the market"}

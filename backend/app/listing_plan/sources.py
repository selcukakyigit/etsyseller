"""Aday ifadeler: var olan veri kaynaklarını birleştirir, yeni bir veri toplama yolu açmaz.

- `keyword_service.scored_pool`: kendi satan listing'ler, rakip etiket/başlık kalıpları, yapıştırılan Etsy verisi (Insights/Ads/arama terimleri),
  araştırma havuzunun Google hacmi + kalabalık sayacı, Etsy sonuç sayısı.
- Araştırma havuzundan ürün adının önerileri ve soru kalıpları (`research.service.expand`): yalnızca OKUNUR; yoksa iş kuyruğa girer (istek içinde
  sağlayıcıya gidilmez). Aday havuzu büyüdükçe aynı ürünün iki listing'i farklı ifadeler seçebilir (simülasyonda görüldü).
- Modelin önerdiği etiketler: "tahmin" olarak aday olur, plan seçer.
Araştırma hata verse bile plan kurulur (havuz yardımcıdır)."""
import logging

from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.keywords import service as keyword_service
from app.shops.models import Shop

log = logging.getLogger(__name__)
MAX_SUGGESTIONS = 40
MAX_QUESTIONS = 8


def pool(db: Session, shop: Shop, listing: dict) -> list[dict]:
    return keyword_service.scored_pool(db, shop, listing)


def research(shop: Shop, seed: str) -> tuple[list[dict], list[dict], int]:
    """(öneri adayları, sorular, kuyruğa alınan iş sayısı). Ortak havuz kendi kısa oturumunda okunur (bkz. keyword_service._attach_research)."""
    from app.research import service as research_service

    if not seed.strip():
        return [], [], 0
    try:
        with SessionLocal() as rdb:
            sugg = research_service.expand(rdb, seed, shop_id=shop.id)
            ques = research_service.expand(rdb, seed, shop_id=shop.id, questions=True)
    except Exception:  # noqa: BLE001
        log.warning("Araştırma havuzu okunamadı (%s)", seed, exc_info=True)
        return [], [], 0
    suggestions = [
        {"tag": m.term, "source": "research", "score": 0, "sample_size": 0, "google_volume": m.search_volume, "intent": m.intent}
        for m in sorted(sugg.metrics.values(), key=lambda m: -(m.search_volume or 0))[:MAX_SUGGESTIONS]
    ]
    questions = [{"q": m.term, "google_volume": m.search_volume} for m in sorted(ques.metrics.values(), key=lambda m: -(m.search_volume or 0))[:MAX_QUESTIONS]]
    return suggestions, questions, (sugg.pending or 0) + (ques.pending or 0)


def queue_measurement(shop: Shop, phrases: list[str]) -> int:
    """Ölçüsü olmayan ifadeleri (yapay zekâ fikirleri) ölçüm kuyruğuna alır; bir dahaki planda "tahmin" değil ölçülü olurlar."""
    from app.research import service as research_service

    if not phrases:
        return 0
    try:
        with SessionLocal() as rdb:
            return research_service.volumes(rdb, phrases, shop_id=shop.id).pending or 0
    except Exception:  # noqa: BLE001
        log.warning("Ölçüm kuyruğa alınamadı", exc_info=True)
        return 0

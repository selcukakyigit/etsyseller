import logging

from app.core.db import SessionLocal
from app.listings import health
from app.shops.models import Shop

logger = logging.getLogger(__name__)


def evaluate_all_shops() -> None:
    """Her bağlı mağaza için listing sağlık durumunu yeniden hesaplar (bkz. listings/health.py).
    daily_stats'ın hemen ardından çalışır çünkü o günün görüntülenme/favori anlık görüntüsüne dayanır."""
    db = SessionLocal()
    try:
        for shop in db.query(Shop).all():
            if shop.oauth_token is None:
                continue
            try:
                health.evaluate_shop(db, shop)
            except Exception:
                logger.exception("Listing health evaluation failed for shop %s", shop.id)
                db.rollback()
    finally:
        db.close()

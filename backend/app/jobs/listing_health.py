import logging

from app.core.db import SessionLocal
from app.insights import impact
from app.listings import changes, health
from app.shops.models import Shop

logger = logging.getLogger(__name__)


def evaluate_all_shops() -> None:
    """Her bağlı mağaza için: Etsy'de yapılmış metin değişikliklerini kaydeder, değişikliklerin etkisini ölçer
    (insights/impact.py) ve listing sağlık durumunu yeniden hesaplar (listings/health.py).
    daily_stats'ın hemen ardından çalışır çünkü üçü de o günün görüntülenme/favori anlık görüntüsüne dayanır."""
    db = SessionLocal()
    try:
        for shop in db.query(Shop).all():
            if shop.oauth_token is None:
                continue
            try:
                changes.detect_etsy_changes(db, shop.id)
                db.commit()
                impact.refresh_shop(db, shop)
                health.evaluate_shop(db, shop)
            except Exception:
                logger.exception("Listing health/impact evaluation failed for shop %s", shop.id)
                db.rollback()
    finally:
        db.close()

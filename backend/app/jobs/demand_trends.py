"""Haftalık talep güncellemesi: sıra takibindeki aramaların Google'daki ilgisi, geçen yılla kıyaslı (bkz. app/insights/demand.py)."""
import logging

from app.core.db import SessionLocal
from app.insights import demand

logger = logging.getLogger(__name__)


def refresh_demand() -> None:
    db = SessionLocal()
    try:
        n = demand.refresh(db)
        if n:
            logger.info("Talep: %s arama güncellendi", n)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Talep güncellemesi başarısız")
    finally:
        db.close()

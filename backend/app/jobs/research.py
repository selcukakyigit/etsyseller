"""Araştırma havuzu işleri: kuyruğu yürütme (dakikalık) ve süresi dolan kelimelerin günlük yenilemesi (bkz. app/research/)."""
import logging

from app.core.db import SessionLocal
from app.research import service, worker

logger = logging.getLogger(__name__)


def run_queue() -> None:
    db = SessionLocal()
    try:
        worker.run_once(db)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Araştırma kuyruğu çalışırken hata")
    finally:
        db.close()


def refresh_stale() -> None:
    db = SessionLocal()
    try:
        n = service.refresh_stale(db)
        if n:
            logger.info("Araştırma: %s kelime yenileme için kuyruğa alındı", n)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Araştırma yenilemesi başarısız")
    finally:
        db.close()

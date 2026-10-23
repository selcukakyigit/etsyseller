"""Araştırma havuzu işleri: kuyruğu yürütme (dakikalık) ve süresi dolan kelimelerin günlük yenilemesi (bkz. app/research/)."""
import json
import logging

from sqlalchemy import select

from app.core.db import SessionLocal
from app.listings.models import ListingCache
from app.research import exposure, service, worker

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


def rebuild_exposure() -> None:
    """Gece: kalabalık sayacını son günlerin önerilerinden yeniden kurar (bkz. research/exposure.py)."""
    db = SessionLocal()
    try:
        n = exposure.rebuild(db)
        logger.info("Araştırma: kalabalık sayacı %s ifade için güncellendi", n)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Kalabalık sayacı güncellenemedi")
    finally:
        db.close()


def warm_own_tags() -> None:
    """Mağazaların listing'lerinde zaten kullanılan etiketlerin hacmini önceden kuyruğa alır: ilk öneride Google verisi hazır olsun."""
    db = SessionLocal()
    try:
        tags: set[str] = set()
        for (raw,) in db.execute(select(ListingCache.raw_json)):
            try:
                tags.update(str(t) for t in json.loads(raw).get("tags") or [])
            except (ValueError, AttributeError):
                continue
        if tags:
            result = service.volumes(db, sorted(tags))
            logger.info("Araştırma: %s etiket ısındırıldı (%s kuyruğa alındı)", len(tags), result.pending)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Etiket ısındırma başarısız")
    finally:
        db.close()

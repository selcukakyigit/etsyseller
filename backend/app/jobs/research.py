"""Araştırma havuzu işleri: kuyruğu yürütme (dakikalık) ve süresi dolan kelimelerin günlük yenilemesi (bkz. app/research/)."""
import json
import logging
import threading

from sqlalchemy import select

from app.core.db import SessionLocal
from app.listings.models import ListingCache
from app.research import exposure, outcomes, service, worker

logger = logging.getLogger(__name__)


_queue_lock = threading.Lock()


def run_queue() -> None:
    """Kuyruğu yürütür. Süreç içinde aynı anda tek yürütücü çalışır (dakikalık iş ve kullanıcı isteğinden tetiklenen arka plan görevleri çakışmasın:
    sağlayıcının hız sınırı aşılmasın); meşgulse sessizce çıkar, çalışan yürütücü işleri zaten alır."""
    if not _queue_lock.acquire(blocking=False):
        return
    db = SessionLocal()
    try:
        worker.run_once(db)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Araştırma kuyruğu çalışırken hata")
    finally:
        db.close()
        _queue_lock.release()


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


def rebuild_signals() -> None:
    """Gece: kalabalık sayacı ve sonuç kanıtı tablolarını yeniden kurar (bkz. research/exposure.py, research/outcomes.py)."""
    db = SessionLocal()
    try:
        logger.info("Araştırma: kalabalık sayacı %s ifade", exposure.rebuild(db))
        logger.info("Araştırma: sonuç kanıtı %s ifade", outcomes.rebuild(db))
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Araştırma sinyalleri güncellenemedi")
    finally:
        db.close()


def warm_own_tags() -> None:
    """Mağazaların listing'lerinde zaten kullanılan etiketlerin hacmini önceden kuyruğa alır: ilk öneride Google verisi hazır olsun."""
    db = SessionLocal()
    try:
        tags: set[str] = set()
        for (raw,) in db.execute(select(ListingCache.raw_json).execution_options(stream_results=True, yield_per=200)):
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


def refresh_trends() -> None:
    """Haftalık: sıra takibindeki aramaların Google ilgisini (geçen yıla göre değişim) yenilemek için kuyruğa alır (bkz. research/service.py)."""
    db = SessionLocal()
    try:
        n = service.refresh_tracked_trends(db)
        if n:
            logger.info("Araştırma: %s arama için trend ölçümü kuyruğa alındı", n)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Trend yenilemesi başarısız")
    finally:
        db.close()

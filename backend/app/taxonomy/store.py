"""Kategori verisi için okuma-yazma önbelleği: süreç belleği → veritabanı → Etsy.

Kategori ağacı ve özellikleri nadiren değişir; bir kez Etsy'den alınıp veritabanına yazılır, MAX_AGE'den eskiyince tazelenir. Etsy'ye ulaşılamazsa
eski kopya kullanılır (kategori verisi yokluğu listing oluşturmayı durdurmaz)."""
import datetime as dt
import json
import logging
from typing import Any, Callable

from sqlalchemy.exc import SQLAlchemyError

from app.core.db import SessionLocal
from app.core.ttl_cache import cached
from app.taxonomy.models import TaxonomyCache

log = logging.getLogger(__name__)

MAX_AGE = dt.timedelta(days=30)


def _read(key: str) -> tuple[Any, dt.datetime] | None:
    try:
        with SessionLocal() as db:
            row = db.get(TaxonomyCache, key)
            return (json.loads(row.data_json), row.fetched_at) if row is not None else None
    except SQLAlchemyError:  # tablo henüz yoksa (göç uygulanmadı) ya da veritabanı geçici hata verirse doğrudan Etsy'ye düşülür
        log.warning("Kategori önbelleği okunamadı: %s", key, exc_info=True)
        return None


def _write(key: str, data: Any) -> None:
    try:
        with SessionLocal() as db:
            row = db.get(TaxonomyCache, key)
            payload = json.dumps(data, ensure_ascii=False)
            if row is None:
                db.add(TaxonomyCache(key=key, data_json=payload, fetched_at=dt.datetime.utcnow()))
            else:
                row.data_json, row.fetched_at = payload, dt.datetime.utcnow()
            db.commit()
    except SQLAlchemyError:
        log.warning("Kategori önbelleği yazılamadı: %s", key, exc_info=True)


def get(key: str, loader: Callable[[], Any]) -> Any:
    """Bellekte varsa onu, yoksa veritabanındaki kopyayı (taze ise), yoksa Etsy'den alıp ikisine de yazar. Kopya eskiyse Etsy denenir, olmazsa eski kopya döner."""

    def load() -> Any:
        stored = _read(key)
        if stored is not None and dt.datetime.utcnow() - stored[1] < MAX_AGE:
            return stored[0]
        try:
            fresh = loader()
        except Exception:  # noqa: BLE001 - Etsy erişilemezse eski kopya (varsa) kullanılır
            if stored is not None:
                log.warning("Etsy kategori verisi alınamadı, eski kopya kullanılıyor: %s", key)
                return stored[0]
            raise
        _write(key, fresh)
        return fresh

    return cached(("tax", key), load)

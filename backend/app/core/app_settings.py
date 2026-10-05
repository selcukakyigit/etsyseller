"""Yönetim panelinden değişen uygulama geneli ayarlar (kredi sistemi açık mı, kâr çarpanı…). Değerler JSON olarak saklanır,
süreç içinde kısa süre önbelleklenir: birden çok süreç (web + worker) en geç CACHE_SECONDS içinde aynı değeri görür.

Tablo yoksa ya da okunamazsa varsayılan döner; bu modül hiçbir zaman isteği düşürmez."""
import datetime as dt
import json
import logging
import threading
import time
from typing import Any

from sqlalchemy import DateTime, String, Text, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.db import Base, SessionLocal

log = logging.getLogger(__name__)
CACHE_SECONDS = 30


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


_lock = threading.Lock()
_cache: tuple[float, dict[str, Any]] | None = None


def _load() -> dict[str, Any]:
    global _cache
    now = time.monotonic()
    with _lock:
        if _cache and now - _cache[0] < CACHE_SECONDS:
            return _cache[1]
    values: dict[str, Any] = {}
    db = SessionLocal()
    try:
        for row in db.scalars(select(AppSetting)).all():
            try:
                values[row.key] = json.loads(row.value_json)
            except json.JSONDecodeError:
                log.warning("Bozuk ayar değeri atlandı: %s", row.key)
    except SQLAlchemyError:
        log.warning("Uygulama ayarları okunamadı; varsayılanlar kullanılıyor", exc_info=True)
    finally:
        db.close()
    with _lock:
        _cache = (now, values)
    return values


def get(key: str, default: Any) -> Any:
    return _load().get(key, default)


def set_many(db: Session, values: dict[str, Any]) -> None:
    """Yazar ve commit eder; ardından bu sürecin önbelleği boşaltılır (commit'ten önce boşaltılsa eşzamanlı bir okuma eski
    değeri yeniden önbelleğe alabilirdi). Diğer süreçler değişikliği CACHE_SECONDS içinde görür."""
    now = dt.datetime.utcnow()
    for key, value in values.items():
        row = db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value_json=json.dumps(value), updated_at=now))
        else:
            row.value_json = json.dumps(value)
            row.updated_at = now
    db.commit()
    clear_cache()


def clear_cache() -> None:
    global _cache
    with _lock:
        _cache = None

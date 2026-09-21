import datetime as dt

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TrendCache(Base):
    """Cached Google Trends interest score per keyword — Google Trends has no
    official public API and aggressively rate-limits repeat queries, so each
    keyword is only re-checked once the cache entry goes stale (see
    keywords/trends.py CACHE_TTL_DAYS)."""

    __tablename__ = "trend_cache"

    keyword: Mapped[str] = mapped_column(String(255), primary_key=True)
    score: Mapped[int] = mapped_column(Integer)
    checked_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

import datetime as dt
import logging

from pytrends.request import TrendReq
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.keywords.models import TrendCache

logger = logging.getLogger(__name__)

CACHE_TTL_DAYS = 7  # trends move slowly; avoids hammering Google's unofficial endpoint
BATCH_SIZE = 5  # pytrends/Google Trends caps comparisons to 5 terms per request


def _fetch_batch(keywords: list[str]) -> dict[str, int]:
    pytrends = TrendReq(hl="tr-TR", tz=180)
    pytrends.build_payload(keywords, timeframe="today 3-m")
    df = pytrends.interest_over_time()
    if df.empty:
        return {kw: 0 for kw in keywords}
    return {kw: int(df[kw].mean()) for kw in keywords if kw in df.columns}


def get_cached_scores(db: Session, keywords: list[str]) -> dict[str, int]:
    """Read-only, no live Google Trends request — whatever's already cached
    from a previous /keyword-pool/trends lookup (any listing, any time
    within CACHE_TTL_DAYS). Used to opportunistically enrich AI suggestion
    generation with trend data *for free*, without adding the several-second
    latency (and Google Trends rate-limit risk) of a live fetch to every
    "AI Önerisi Üret" click."""
    now = dt.datetime.utcnow()
    cutoff = now - dt.timedelta(days=CACHE_TTL_DAYS)
    return {
        row.keyword: row.score
        for row in db.scalars(
            select(TrendCache).where(TrendCache.keyword.in_(keywords)).where(TrendCache.checked_at >= cutoff)
        ).all()
    }


def get_trend_scores(db: Session, keywords: list[str]) -> dict[str, int]:
    """Average Google search interest (0-100, relative to the keyword's own
    peak — not an absolute volume) over the last 3 months, per keyword.

    This is Google web-search demand, not Etsy on-site search demand — Etsy
    doesn't publish the latter via any official API. Treat it as a rough,
    free proxy for "is anyone looking for this at all", not ground truth.
    Best-effort: a failed batch (rate-limited, network error) is skipped
    rather than failing the whole request, so partial results still return.
    """
    now = dt.datetime.utcnow()
    cached = get_cached_scores(db, keywords)
    missing = [kw for kw in keywords if kw not in cached]
    fetched: dict[str, int] = {}
    for i in range(0, len(missing), BATCH_SIZE):
        batch = missing[i : i + BATCH_SIZE]
        try:
            fetched.update(_fetch_batch(batch))
        except Exception:
            logger.exception("Google Trends fetch failed for batch %s", batch)

    for keyword, score in fetched.items():
        row = db.get(TrendCache, keyword)
        if row is None:
            db.add(TrendCache(keyword=keyword, score=score, checked_at=now))
        else:
            row.score = score
            row.checked_at = now
    if fetched:
        db.commit()

    return {**cached, **fetched}

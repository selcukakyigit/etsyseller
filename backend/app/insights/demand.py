"""Talep: bir aramaya Google'daki ilgi geçen yıla göre nasıl değişti?

Soru şu: "Talep mi düştü, yoksa biz mi geri düştük?" Google'da ilgi de düştüyse sorunun büyük kısmı talep; aynı
kaldıysa sorun listing'de (sıra, rekabet, fiyat). Google Trends Etsy içi aramayı değil Google aramasını gösterir; burada
yalnızca yön ve büyüklük için kullanılır. Resmî API'si henüz kapalı alfa, kullanılan erişim gayriresmî ve kırılgan:
başarısız olursa sessizce atlanır, teşhis diğer sinyallerle devam eder.

Haftada bir, yalnızca sıra takibindeki aramalar için çekilir. Son 13 haftanın ortalaması, geçen yılın aynı 13 haftasıyla
kıyaslanır (mevsim etkisi böylece ayrılır)."""
import datetime as dt
import logging
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.insights.models import DemandTrend, TrackedKeyword

log = logging.getLogger(__name__)

BATCH = 5  # Google Trends tek istekte en fazla 5 terim karşılaştırır
MAX_PER_RUN = 40
REFRESH_DAYS = 6
WEEKS = 13
PAUSE_SECONDS = 4  # Google'ın hız sınırına takılmamak için gruplar arası bekleme
MIN_INTEREST = 3.0  # geçen yılki ilgi bunun altındaysa (Google'da çok az aranıyorsa) yıllık değişim gürültüdür, hesaplanmaz


def _fetch(keywords: list[str]) -> dict[str, tuple[float, float]]:
    """kelime -> (son 13 hafta ortalaması, geçen yılın aynı 13 haftası ortalaması). Aynı istekteki terimler birbirine
    göre ölçeklenir ama her terimin kendi içindeki yıllık oranı bundan etkilenmez."""
    from pytrends.request import TrendReq  # pandas'ı yükler; yalnızca ölçüm yapılırken içe aktarılır

    pytrends = TrendReq(hl="en-US", tz=0)
    pytrends.build_payload(keywords, timeframe="today 5-y")
    df = pytrends.interest_over_time()
    out: dict[str, tuple[float, float]] = {}
    if df.empty:
        return out
    for kw in keywords:
        if kw not in df.columns:
            continue
        series = df[kw]
        last_date = series.index[-1]
        recent = series[series.index > last_date - dt.timedelta(weeks=WEEKS)]
        prev = series[(series.index > last_date - dt.timedelta(weeks=WEEKS + 52)) & (series.index <= last_date - dt.timedelta(weeks=52))]
        if len(recent) and len(prev):
            out[kw] = (float(recent.mean()), float(prev.mean()))
    return out


def refresh(db: Session, now: dt.datetime | None = None) -> int:
    """Sıra takibindeki aramaların talebini günceller (son çekimi `REFRESH_DAYS` günden eski olanlar)."""
    now = now or dt.datetime.utcnow()
    tracked = sorted({k for (k,) in db.execute(select(TrackedKeyword.keyword).where(TrackedKeyword.active.is_(True)))})
    fresh = {k for (k,) in db.execute(select(DemandTrend.keyword).where(DemandTrend.fetched_at >= now - dt.timedelta(days=REFRESH_DAYS)))}
    todo = [k for k in tracked if k not in fresh][:MAX_PER_RUN]
    done = 0
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        try:
            values = _fetch(batch)
        except Exception:  # noqa: BLE001 — Google sınırladıysa kalanlar bir sonraki çalışmaya kalır
            log.warning("Google Trends talebi alınamadı: %s", batch, exc_info=True)
            break
        for kw in batch:
            row = db.get(DemandTrend, kw) or DemandTrend(keyword=kw)
            recent, prev = values.get(kw, (None, None))
            row.recent, row.previous = recent, prev
            row.yoy_pct = round((recent - prev) / prev * 100) if recent is not None and prev is not None and prev >= MIN_INTEREST else None
            row.fetched_at = now
            db.add(row)
            done += 1
        db.commit()
        time.sleep(PAUSE_SECONDS)
    return done


def for_keywords(db: Session, keywords: list[str]) -> dict[str, DemandTrend]:
    if not keywords:
        return {}
    return {r.keyword: r for r in db.scalars(select(DemandTrend).where(DemandTrend.keyword.in_(keywords)))}

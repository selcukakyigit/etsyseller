"""Yönetim > Araştırma: havuzun ülke haritası (yalnızca okuma). Havuzdaki GÜNCEL ölçümler pazar başına toplanır: kaç kelime ölçülmüş, toplam aylık Google araması, tazelik,
kapsam ve o ayki sağlayıcı harcaması. Süzgeç, kelime listesiyle AYNI `KeywordFilters`tır (admin_pool.apply_*_filters) ve bölge seçimi eklenir; böylece haritada gördüğün küme
Keyword Explorer'da da aynı süzgeçle açılır. Ham sayılar yalnızca yöneticiye gider."""
import datetime as dt

from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.dates import iso
from app.research import admin_pool, budget, policy
from app.research.models import KeywordMetric, KeywordTerm, ProviderCall
from app.research.providers import get_provider

ENGLISH = frozenset({"US", "GB", "CA", "AU", "NZ", "IE"})
WEST = frozenset({"GB", "IE", "DE", "FR", "NL", "BE", "LU", "AT", "CH", "IT", "ES", "PT", "SE", "NO", "DK", "FI", "IS"})
EU = frozenset({"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"})
REGIONS = {"english": ENGLISH, "west": WEST, "eu": EU}


class MapQuery(admin_pool.KeywordFilters):
    """Harita sorgusu: kelime süzgeci (pazar alanı yok sayılır: tüm pazarlar gelir) + bölge. `region`: english (İngilizce pazarlar) | west (Batı ve Kuzey Avrupa) | eu | other (hiçbiri)."""

    region: str = Field("", pattern="^(|english|west|eu|other)$")


class MarketOut(BaseModel):
    market: str
    keywords: int  # bu pazarda güncel ölçümü olan (süzgece uyan) kelime; sağlayıcı "veri yok" dese de ölçüm yapılmıştır
    with_volume: int  # bunlardan hacmi gelenler
    volume: int  # toplam aylık Google araması (hacmi gelenlerin toplamı)
    avg_cpc: float | None
    fresh: int
    stale: int
    coverage: int  # % : süzgece uyan havuz kelimelerinin kaçı bu pazarda ölçülmüş
    last_measured: str | None
    spend_month: float  # bu ay bu pazara yapılan sağlayıcı çağrılarının maliyeti (USD; kelime süzgecinden bağımsız)
    calls_month: int
    default: bool
    configured: bool  # sağlayıcı bu pazarı ölçebiliyor (haftalık iş onu kapsıyor)


class MapOut(BaseModel):
    language: str
    default_market: str
    terms: int  # süzgece uyan havuz kelimesi (bu dilde)
    rows: list[MarketOut]


def in_region(market: str, region: str) -> bool:
    if not region:
        return True
    if region == "other":
        return not any(market in group for group in REGIONS.values())
    return market in REGIONS[region]


def _spend(db: Session) -> dict[str, tuple[float, int]]:
    rows = db.execute(
        select(ProviderCall.market, func.coalesce(func.sum(ProviderCall.cost_usd), 0), func.count(ProviderCall.id))
        .where(ProviderCall.created_at >= budget.month_start()).group_by(ProviderCall.market)
    ).all()
    return {m: (round(float(c), 4), int(n)) for m, c, n in rows}


def pool_map(db: Session, q: MapQuery) -> MapOut:
    now = dt.datetime.utcnow()
    _, language = q.resolved()
    default = str(policy.get("research_default_market"))
    metric = KeywordMetric
    agg = (
        select(
            metric.market, func.count(metric.id), func.count(metric.search_volume), func.coalesce(func.sum(metric.search_volume), 0), func.avg(metric.cpc),
            func.coalesce(func.sum(case((metric.expires_at > now, 1), else_=0)), 0), func.max(metric.measured_at),
        )
        .join(KeywordTerm, KeywordTerm.id == metric.keyword_id)
        .where(metric.is_latest.is_(True), metric.language == language, KeywordTerm.language == language)
        .group_by(metric.market)
    )
    agg = admin_pool.apply_metric_filters(admin_pool.apply_term_filters(agg, q, now), q, now)
    terms_query = admin_pool.apply_term_filters(select(func.count(KeywordTerm.id)).where(KeywordTerm.language == language), q, now)
    terms = int(db.scalar(terms_query) or 0)
    measured = {r[0]: r for r in db.execute(agg).all()}
    spend = _spend(db)
    configured = set(get_provider().markets)
    rows = []
    for market in sorted((configured | set(measured) | {default}), key=lambda m: m):
        if not in_region(market, q.region):
            continue
        _, n, with_volume, volume, cpc, fresh, last = measured.get(market, (market, 0, 0, 0, None, 0, None))
        cost, calls = spend.get(market, (0.0, 0))
        rows.append(MarketOut(
            market=market, keywords=int(n), with_volume=int(with_volume), volume=int(volume), avg_cpc=round(float(cpc), 2) if cpc is not None else None,
            fresh=int(fresh), stale=int(n) - int(fresh), coverage=round(int(n) / terms * 100) if terms else 0, last_measured=iso(last) if last else None,
            spend_month=cost, calls_month=calls, default=market == default, configured=market in configured,
        ))
    rows.sort(key=lambda r: (-r.volume, -r.keywords, r.market))
    return MapOut(language=language, default_market=default, terms=terms, rows=rows)

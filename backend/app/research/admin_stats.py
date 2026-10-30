"""Yönetim > Araştırma: havuz sağlığı ve kullanım analitiği (yalnızca okuma). Havuz sağlığı havuzun KENDİSİNİ (tazelik, dağılım, yenileme maliyeti),
analitik havuzun nasıl KULLANILDIĞINI (önbellek isabeti, gecikme, aranan kelimeler) anlatır."""
import datetime as dt
import time

from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.research import policy, stats
from app.research.models import KeywordMetric, KeywordTerm, ProviderCall, ResearchJob, SearchDaily, UsageDaily

_HEALTH_TTL = 60.0  # sn: sağlık özeti (birkaç büyük sayım) bu kadar önbellekte; panel her açılışta tabloyu taramasın
_health_cache: tuple[float, tuple[str, str], "HealthOut"] | None = None
LATENCY_KINDS = ("volume", "suggest", "season")
TOP = 20


class CountOut(BaseModel):
    key: str
    count: int


class RefreshForecastOut(BaseModel):
    due: int  # önümüzdeki 30 günde süresi dolacak (ya da dolmuş) ve yenilenecek kelime
    requests: int
    estimated_usd: float | None  # son 30 günün ortalama hacim isteği maliyetine göre; hiç istek yoksa None


class HealthOut(BaseModel):
    market: str
    language: str
    terms: int  # bu dildeki kelime sayısı
    fresh: int
    expiring_7d: int  # güncel ama 7 gün içinde dolacak
    stale: int
    missing: int
    status: dict[str, int]  # active | archived | blocked
    pinned: int
    unused_90d: int
    metric_rows: int
    sources: list[CountOut]
    markets: list[CountOut]  # "US/en" -> ölçümlü (güncel satırı olan) kelime
    forecast: RefreshForecastOut


class DayUsageOut(BaseModel):
    day: str
    search_hit: int
    search_stale: int
    search_miss: int
    volume_fresh: int
    volume_stale: int
    volume_miss: int
    refused: int


class LatencyOut(BaseModel):
    kind: str
    jobs: int
    p50_s: float | None
    p95_s: float | None


class SearchTermOut(BaseModel):
    term: str
    market: str
    searches: int
    empty: int


class ShopUsageOut(BaseModel):
    shop_id: int
    jobs: int
    cost_usd: float


class AnalyticsOut(BaseModel):
    days: list[DayUsageOut]
    hit_rate: float | None  # Keşfet aramalarında havuzdan hemen karşılanan oranı (0–1); arama yoksa None
    refused: list[CountOut]  # neden -> sayı (30 gün)
    latency: list[LatencyOut]  # iş oluşturulmasından bitişe (kuyruk bekleme + çalışma), son 7 gün
    top_searches: list[SearchTermOut]
    empty_searches: list[SearchTermOut]
    shops: list[ShopUsageOut]


def _count(db: Session, *where) -> int:
    return int(db.scalar(select(func.count()).select_from(KeywordTerm).where(*where)) or 0)


def health(db: Session, market: str | None = None, language: str | None = None) -> HealthOut:
    market = (market or policy.get("research_default_market")).upper()
    language = (language or policy.get("research_default_language")).lower()
    global _health_cache
    if _health_cache and time.monotonic() - _health_cache[0] < _HEALTH_TTL and _health_cache[1] == (market, language):
        return _health_cache[2]
    now = dt.datetime.utcnow()
    week = now + dt.timedelta(days=7)
    month = now + dt.timedelta(days=30)

    latest = (KeywordMetric.market == market) & (KeywordMetric.language == language) & KeywordMetric.is_latest.is_(True)
    fresh, expiring, stale, due = db.execute(
        select(
            func.sum(case((KeywordMetric.expires_at > now, 1), else_=0)),
            func.sum(case(((KeywordMetric.expires_at > now) & (KeywordMetric.expires_at <= week), 1), else_=0)),
            func.sum(case((KeywordMetric.expires_at <= now, 1), else_=0)),
            func.sum(case((KeywordMetric.expires_at <= month, 1), else_=0)),
        ).join(KeywordTerm, KeywordTerm.id == KeywordMetric.keyword_id).where(latest, KeywordTerm.status == "active")
    ).one()
    fresh, expiring, stale, due = int(fresh or 0), int(expiring or 0), int(stale or 0), int(due or 0)
    in_language = KeywordTerm.language == language
    terms = _count(db, in_language)
    measured = int(db.scalar(select(func.count()).select_from(KeywordMetric).where(latest)) or 0)
    status = {s: n for s, n in db.execute(select(KeywordTerm.status, func.count()).where(in_language).group_by(KeywordTerm.status)).all()}
    sources = db.execute(select(KeywordTerm.first_source, func.count()).where(in_language).group_by(KeywordTerm.first_source).order_by(func.count().desc())).all()
    markets = db.execute(
        select(KeywordMetric.market, KeywordMetric.language, func.count()).where(KeywordMetric.is_latest.is_(True)).group_by(KeywordMetric.market, KeywordMetric.language)
        .order_by(func.count().desc())
    ).all()

    avg = db.scalar(select(func.avg(ProviderCall.cost_usd)).where(ProviderCall.kind == "volume", ProviderCall.ok.is_(True), ProviderCall.created_at >= now - dt.timedelta(days=30)))
    requests = -(-due // 1000) if due else 0  # sağlayıcı tek istekte en çok 1000 kelime; ücret istek başınadır. Tahmin: vadesi gelenlerin hepsi yenilenirse
    out = HealthOut(
        market=market, language=language, terms=terms, fresh=fresh, expiring_7d=expiring, stale=stale, missing=max(0, terms - measured),
        status={s: int(status.get(s, 0)) for s in ("active", "archived", "blocked")}, pinned=_count(db, in_language, KeywordTerm.pinned.is_(True)),
        unused_90d=_count(db, in_language, (KeywordTerm.last_used_at.is_(None)) | (KeywordTerm.last_used_at < now - dt.timedelta(days=90))),
        metric_rows=int(db.scalar(select(func.count()).select_from(KeywordMetric)) or 0),
        sources=[CountOut(key=s or "-", count=int(n)) for s, n in sources], markets=[CountOut(key=f"{m}/{lang}", count=int(n)) for m, lang, n in markets],
        forecast=RefreshForecastOut(due=due, requests=requests, estimated_usd=round(float(avg) * requests, 2) if avg is not None else None),
    )
    _health_cache = (time.monotonic(), (market, language), out)
    return out


def clear_cache() -> None:
    global _health_cache
    _health_cache = None


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(q * len(ordered)))], 1)


def analytics(db: Session, days: int = 30) -> AnalyticsOut:
    today = dt.datetime.utcnow().date()
    since = today - dt.timedelta(days=days - 1)
    per_day: dict[dt.date, dict[str, int]] = {}
    refused: dict[str, int] = {}
    for day, event, n in db.execute(select(UsageDaily.day, UsageDaily.event, UsageDaily.n).where(UsageDaily.day >= since)).all():
        per_day.setdefault(day, {})[event] = per_day.get(day, {}).get(event, 0) + int(n)
        if event.startswith(stats.REFUSED_PREFIX):
            refused[event[len(stats.REFUSED_PREFIX):]] = refused.get(event[len(stats.REFUSED_PREFIX):], 0) + int(n)
    series = []
    for i in range(days):
        d = since + dt.timedelta(days=i)
        e = per_day.get(d, {})
        series.append(DayUsageOut(
            day=d.isoformat(), search_hit=e.get(stats.SEARCH_HIT, 0), search_stale=e.get(stats.SEARCH_STALE, 0), search_miss=e.get(stats.SEARCH_MISS, 0),
            volume_fresh=e.get(stats.VOLUME_FRESH, 0), volume_stale=e.get(stats.VOLUME_STALE, 0), volume_miss=e.get(stats.VOLUME_MISS, 0),
            refused=sum(v for k, v in e.items() if k.startswith(stats.REFUSED_PREFIX)),
        ))
    hits, total = sum(d.search_hit for d in series), sum(d.search_hit + d.search_stale + d.search_miss for d in series)

    week = dt.datetime.utcnow() - dt.timedelta(days=7)
    waits: dict[str, list[float]] = {k: [] for k in LATENCY_KINDS}
    for kind, created, finished in db.execute(
        select(ResearchJob.kind, ResearchJob.created_at, ResearchJob.finished_at)
        .where(ResearchJob.status == "done", ResearchJob.finished_at >= week, ResearchJob.kind.in_(LATENCY_KINDS), ResearchJob.shop_id.is_not(None)).limit(5000)
    ).all():
        waits[kind].append((finished - created).total_seconds())  # shop_id dolu = kullanıcı isteğiyle açılan iş (sistem yenilemeleri beklemeyi çarpıtmasın)

    def terms(order, *where) -> list[SearchTermOut]:
        rows = db.execute(
            select(SearchDaily.term, SearchDaily.market, func.sum(SearchDaily.n), func.sum(SearchDaily.empty)).where(SearchDaily.day >= since, *where)
            .group_by(SearchDaily.term, SearchDaily.market).order_by(order, SearchDaily.term).limit(TOP)
        ).all()
        return [SearchTermOut(term=t, market=m, searches=int(n or 0), empty=int(e or 0)) for t, m, n, e in rows]

    shops = db.execute(
        select(ResearchJob.shop_id, func.count(), func.coalesce(func.sum(ResearchJob.cost_usd), 0))
        .where(ResearchJob.shop_id.is_not(None), ResearchJob.created_at >= dt.datetime.combine(since, dt.time())).group_by(ResearchJob.shop_id)
        .order_by(func.count().desc()).limit(10)
    ).all()
    return AnalyticsOut(
        days=series, hit_rate=round(hits / total, 3) if total else None,
        refused=[CountOut(key=k, count=v) for k, v in sorted(refused.items(), key=lambda kv: -kv[1])],
        latency=[LatencyOut(kind=k, jobs=len(v), p50_s=_percentile(v, 0.5), p95_s=_percentile(v, 0.95)) for k, v in waits.items()],
        top_searches=terms(func.sum(SearchDaily.n).desc()),
        empty_searches=terms(func.sum(SearchDaily.empty).desc(), SearchDaily.empty > 0),
        shops=[ShopUsageOut(shop_id=int(s), jobs=int(n), cost_usd=round(float(c or 0), 4)) for s, n, c in shops],
    )

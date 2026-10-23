"""Araştırma havuzunun tek giriş kapısı (editör, analiz, asistan ve yönetim bunu çağırır). Kural: bu işlevler ASLA sağlayıcıya istek atmaz.
Havuzda güncel veri varsa döner; yoksa/eskiyse iş kuyruğa alınır ve çağırana "hazırlanıyor" (`pending`) bilgisi verilir."""
import datetime as dt
import hashlib
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.research import budget, credentials, jobs, policy, pool
from app.research.models import KeywordLink, KeywordMetric, KeywordTerm
from app.research.providers import DEFAULT_PROVIDER, get_provider
from app.research.terms import normalize, researchable


@dataclass
class MetricView:
    term: str
    search_volume: int | None
    cpc: float | None
    competition: float | None  # Google Ads REKLAM rekabeti (0–1); Etsy organik rekabeti değildir
    difficulty: int | None
    intent: str | None
    measured_at: dt.datetime
    fresh: bool


@dataclass
class Lookup:
    """`metrics`: havuzda ölçümü olan kelimeler (eskimiş olabilir, `fresh` söyler). `pending`: kuyruğa alınan/bekleyen kelime sayısı.
    `refused`: kuyruğa alınamadıysa nedeni (budget | shop_daily | disabled | not_configured | market), yoksa None."""

    metrics: dict[str, MetricView] = field(default_factory=dict)
    pending: int = 0
    refused: str | None = None


@dataclass
class TrendView:
    term: str
    recent: float | None
    previous: float | None
    yoy_pct: int | None  # geçen yıla göre %; geçen yılki ilgi çok düşükse None
    measured_at: dt.datetime
    fresh: bool


@dataclass
class TrendLookup:
    """`trends`: havuzda ölçümü olan kelimeler (eskimiş olabilir). `pending`/`refused`: bkz. `Lookup`."""

    trends: dict[str, TrendView] = field(default_factory=dict)
    pending: int = 0
    refused: str | None = None


def _view(term: str, m: KeywordMetric, now: dt.datetime) -> MetricView:
    return MetricView(term, m.search_volume, m.cpc, m.competition, m.difficulty, m.intent, m.measured_at, fresh=m.expires_at > now)


def peek(db: Session, terms: list[str], *, market: str | None = None, language: str | None = None) -> dict[str, MetricView]:
    """Yalnızca OKUR: havuzda ölçümü olan kelimelerin en yeni ölçümü (kelime eklemez, kuyruğa almaz, commit etmez)."""
    market, language = _market(market, language)
    rows = pool.find_terms(db, terms, language)
    latest = pool.latest_metrics(db, [r.id for r in rows.values()], market, language)
    now = dt.datetime.utcnow()
    return {term: _view(term, latest[row.id], now) for term, row in rows.items() if row.id in latest}


def _market(market: str | None, language: str | None) -> tuple[str, str]:
    return market or policy.get("research_default_market"), language or policy.get("research_default_language")


def _available(db: Session, market: str) -> str | None:
    """Neden araştırma yapılamıyor (yoksa None)."""
    if not policy.get("research_enabled"):
        return "disabled"
    if credentials.get(db, DEFAULT_PROVIDER) is None:
        return "not_configured"
    if not get_provider().supports_market(market):
        return "market"
    return None


def volumes(db: Session, terms: list[str], *, market: str | None = None, language: str | None = None, shop_id: int | None = None) -> Lookup:
    """Kelimelerin Google arama hacmi/CPC/rekabeti. Eksik ya da süresi dolmuş olanlar kuyruğa alınır; havuzdaki eski değer yine döner."""
    market, language = _market(market, language)
    wanted = list(dict.fromkeys(t for t in (normalize(x) for x in terms) if researchable(t)))
    out = Lookup()
    if not wanted:
        return out
    rows = pool.get_or_create_terms(db, wanted, language, "volume")
    pool.touch(db, [r.id for r in rows.values()])
    latest = pool.latest_metrics(db, [r.id for r in rows.values()], market, language)
    now = dt.datetime.utcnow()
    stale: list[str] = []
    for term, row in rows.items():
        m = latest.get(row.id)
        if m is not None:
            out.metrics[term] = _view(term, m, now)
        if m is None or m.expires_at <= now:
            stale.append(term)
    if stale:
        out.refused = _available(db, market)
        if out.refused is None:
            out.refused, out.pending = _enqueue_volumes(db, stale, market, language, shop_id)
    db.commit()
    return out


def _enqueue_volumes(db: Session, stale: list[str], market: str, language: str, shop_id: int | None) -> tuple[str | None, int]:
    provider = get_provider()
    size = provider.max_volume_terms
    pending = 0
    for i in range(0, len(stale), size):
        part = sorted(stale[i : i + size])
        key = f"volume:{market}:{language}:" + hashlib.sha1("|".join(part).encode()).hexdigest()
        try:
            jobs.enqueue(db, kind="volume", provider=provider.name, market=market, language=language, key=key, payload={"terms": part}, shop_id=shop_id)
            pending += len(part)
        except budget.QueueRefused as exc:
            return exc.reason, pending
    return None, pending


def trends(
    db: Session, terms: list[str], *, market: str | None = None, language: str | None = None, shop_id: int | None = None, enqueue: bool = True,
) -> TrendLookup:
    """Kelimelerin Google ilgi endeksi ve geçen yıla göre değişimi (talebin yönü). Eksik ya da süresi dolmuş olanlar kuyruğa alınır.
    `enqueue=False`: yalnızca havuzdan OKUR (kelime eklemez, kuyruğa almaz, commit etmez); başka bir işlemin ortasında çağrılırken kullanılır."""
    market, language = _market(market, language)
    wanted = list(dict.fromkeys(t for t in (normalize(x) for x in terms) if researchable(t)))
    out = TrendLookup()
    if not wanted:
        return out
    rows = pool.get_or_create_terms(db, wanted, language, "trend") if enqueue else pool.find_terms(db, wanted, language)
    latest = pool.latest_trends(db, [r.id for r in rows.values()], market, language)
    now = dt.datetime.utcnow()
    stale: list[str] = []
    for term, row in rows.items():
        t = latest.get(row.id)
        if t is not None:
            out.trends[term] = TrendView(term, t.recent, t.previous, t.yoy_pct, t.measured_at, fresh=t.expires_at > now)
        if t is None or t.expires_at <= now:
            stale.append(term)
    if stale and enqueue:
        out.refused = _available(db, market)
        if out.refused is None:
            out.refused, out.pending = _enqueue_trends(db, stale, market, language, shop_id)
    if enqueue:
        db.commit()
    return out


def refresh_tracked_trends(db: Session, limit: int = 200) -> int:
    """Haftalık: sıra takibindeki (etkin) aramaların trendini yeniler; süresi dolmamış olanlar kuyruğa alınmaz. Kuyruğa alınan kelime sayısını döner."""
    from app.insights.models import TrackedKeyword

    tracked = sorted({k for (k,) in db.execute(select(TrackedKeyword.keyword).where(TrackedKeyword.active.is_(True)))})[:limit]
    return trends(db, tracked).pending if tracked else 0


def _enqueue_trends(db: Session, stale: list[str], market: str, language: str, shop_id: int | None) -> tuple[str | None, int]:
    provider = get_provider()
    size = provider.max_trend_terms
    pending = 0
    for i in range(0, len(stale), size):
        part = sorted(stale[i : i + size])
        key = f"trend:{market}:{language}:" + hashlib.sha1("|".join(part).encode()).hexdigest()
        try:
            jobs.enqueue(db, kind="trend", provider=provider.name, market=market, language=language, key=key, payload={"terms": part}, shop_id=shop_id)
            pending += len(part)
        except budget.QueueRefused as exc:
            return exc.reason, pending
    return None, pending


def expand(db: Session, seed: str, *, market: str | None = None, language: str | None = None, shop_id: int | None = None, limit: int = 100) -> Lookup:
    """Tohum kelimenin önerileri (havuzdan). Daha önce genişletilmediyse ya da süresi dolduysa iş kuyruğa alınır."""
    market, language = _market(market, language)
    term = normalize(seed)
    out = Lookup()
    if not researchable(term):
        return out
    rows = pool.get_or_create_terms(db, [term], language, "suggestion")
    seed_row = rows[term]
    pool.touch(db, [seed_row.id])
    now = dt.datetime.utcnow()
    related = db.scalars(
        select(KeywordTerm).join(KeywordLink, KeywordLink.keyword_id == KeywordTerm.id)
        .where(KeywordLink.seed_id == seed_row.id, KeywordLink.relation == "suggestion").order_by(KeywordLink.rank)
    ).all()
    latest = pool.latest_metrics(db, [r.id for r in related], market, language)
    for r in related:
        if r.id in latest:
            out.metrics[r.term] = _view(r.term, latest[r.id], now)
    newest = max((m.measured_at for m in latest.values()), default=None)
    ttl = dt.timedelta(days=float(policy.get("research_ttl_suggest_days")))
    if newest is None or now - newest > ttl:
        out.refused = _available(db, market)
        if out.refused is None:
            key = f"suggest:{market}:{language}:{term}"
            try:
                jobs.enqueue(db, kind="suggest", provider=DEFAULT_PROVIDER, market=market, language=language, key=key,
                             payload={"seed": term, "limit": limit}, shop_id=shop_id)
                out.pending = 1
            except budget.QueueRefused as exc:
                out.refused = exc.reason
    db.commit()
    return out


def request_refresh(db: Session, terms: list[str], *, market: str | None = None, language: str | None = None) -> Lookup:
    """Yönetim: seçili kelimeleri TTL'e bakmadan yenile."""
    market, language = _market(market, language)
    out = Lookup()
    out.refused = _available(db, market)
    if out.refused is None:
        wanted = [t for t in dict.fromkeys(normalize(x) for x in terms) if researchable(t)]
        pool.get_or_create_terms(db, wanted, language, "admin")
        out.refused, out.pending = _enqueue_volumes(db, wanted, market, language, None)
    db.commit()
    return out


def refresh_stale(db: Session) -> int:
    """Günlük otomatik yenileme: yakın zamanda KULLANILMIŞ ve süresi dolmuş kelimeleri toplu işe çevirir. Kullanılmayan kelimeye para harcanmaz."""
    market, language = _market(None, None)
    if _available(db, market) is not None or budget.over_budget(db):
        return 0
    now = dt.datetime.utcnow()
    since = now - dt.timedelta(days=int(policy.get("research_active_days")))
    limit = int(policy.get("research_refresh_per_day"))
    candidates = db.scalars(
        select(KeywordTerm).where(KeywordTerm.language == language, KeywordTerm.last_used_at >= since).order_by(KeywordTerm.last_used_at.desc())
    ).all()
    latest = pool.latest_metrics(db, [c.id for c in candidates], market, language)
    due = [c.term for c in candidates if c.id not in latest or latest[c.id].expires_at <= now][:limit]
    if due:
        _enqueue_volumes(db, due, market, language, None)
    db.commit()
    return len(due)

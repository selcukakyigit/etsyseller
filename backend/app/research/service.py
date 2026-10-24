"""Araştırma havuzunun tek giriş kapısı (editör, analiz, asistan ve yönetim bunu çağırır). Kural: bu işlevler ASLA sağlayıcıya istek atmaz.
Havuzda güncel veri varsa döner; yoksa/eskiyse iş kuyruğa alınır ve çağırana "hazırlanıyor" (`pending`) bilgisi verilir."""
import datetime as dt
import hashlib
import json
from dataclasses import dataclass, field

from sqlalchemy import func, select
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
    monthly: list[int] = field(default_factory=list)  # son 12 ayın aylık aramaları (eskiden yeniye); veri yoksa boş
    last_month: str | None = None  # serinin son ayı "YYYY-AA" (önceki ayları buradan geriye sayılır: Google aylık serisi ardışıktır)


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


PEAK_FROM = 85  # zirve sayılan ay: profilde en az bu değer (zirve = 100)
SEASONAL_RATIO = 1.8  # zirve / ortalama bu oranı aşarsa kelime mevsimsel sayılır


@dataclass
class SeasonView:
    """Mevsimsellik: `monthly` Oca..Ara göreli ilgi (zirve = 100), boşsa profil çıkarılamadı (düşük hacim / kısa geçmiş). `pending`: ölçüm sırada."""

    monthly: list[int] = field(default_factory=list)
    peak_months: list[int] = field(default_factory=list)  # 1..12
    seasonal: bool = False
    pending: bool = False
    refused: str | None = None
    too_rare: bool = False  # ölçülmüş aylık arama `research_season_min_volume` altında: istenmez, ücret ödenmez
    min_volume: int = 0


def season_view(monthly: list[int] | None) -> SeasonView:
    if not monthly or len(monthly) != 12:
        return SeasonView()
    mean = sum(monthly) / 12
    return SeasonView(
        monthly=list(monthly), peak_months=[m + 1 for m, v in enumerate(monthly) if v >= PEAK_FROM], seasonal=bool(mean) and max(monthly) / mean >= SEASONAL_RATIO,
    )


def seasonality(db: Session, term: str, *, market: str | None = None, language: str | None = None, shop_id: int | None = None) -> SeasonView:
    """Kelimenin mevsimsellik profili (havuzdan). Yoksa/eskiyse tek kelimelik bir iş kuyruğa alınır (`pending`); sağlayıcıya istek atılmaz."""
    market, language = _market(market, language)
    key_term = normalize(term)
    if not researchable(key_term):
        return SeasonView()
    row = pool.find_terms(db, [key_term], language).get(key_term)
    latest = pool.latest_season(db, row.id, market, language) if row else None
    now = dt.datetime.utcnow()
    view = season_view(json.loads(latest.monthly_json)) if latest and latest.monthly_json else SeasonView()
    if latest and latest.expires_at > now:
        return view
    minimum = int(policy.get("research_season_min_volume"))
    metric = pool.latest_metrics(db, [row.id], market, language).get(row.id) if row else None
    if metric is not None and (metric.search_volume or 0) < minimum:  # hacmi ölçülmemiş kelime için karar verilemez; yalnızca ölçülmüş düşük hacim elenir
        return SeasonView(too_rare=True, min_volume=minimum)
    key = f"season:{market}:{language}:{key_term}"
    if jobs.active_by_key(db, key):
        view.pending = True
        return view
    view.refused = _available(db, market)
    if view.refused is None:
        try:
            jobs.enqueue(db, kind="season", provider=DEFAULT_PROVIDER, market=market, language=language, key=key, payload={"term": key_term}, shop_id=shop_id)
            view.pending = True
        except budget.QueueRefused as exc:
            view.refused = exc.reason
    db.commit()
    return view


def season_cached(db: Session, terms: list[str], *, market: str | None = None, language: str | None = None) -> dict[str, SeasonView]:
    """Yalnızca OKUR: havuzda mevsimsellik ölçümü olan kelimelerin (süresi dolmuş olsa da) profili. İş açmaz, sağlayıcıya gitmez; ölçümü olmayan kelime sonuçta yoktur."""
    market, language = _market(market, language)
    rows = pool.find_terms(db, terms, language)
    out: dict[str, SeasonView] = {}
    for term, row in rows.items():
        latest = pool.latest_season(db, row.id, market, language)
        if latest:
            out[term] = season_view(json.loads(latest.monthly_json)) if latest.monthly_json else SeasonView()
    return out


def _series(monthly_json: str | None) -> list[int]:
    """[[yıl, ay, hacim], …] -> tarih sırasıyla (eskiden yeniye) hacimler; en fazla son 12 ay."""
    if not monthly_json:
        return []
    try:
        rows = sorted(json.loads(monthly_json), key=lambda r: (r[0], r[1]))
    except (ValueError, TypeError, IndexError):
        return []
    return [int(r[2]) for r in rows if len(r) > 2 and r[2] is not None][-12:]


def _last_month(monthly_json: str | None) -> str | None:
    """Aylık serinin son ayı ("YYYY-AA"); seri yoksa None."""
    if not monthly_json:
        return None
    try:
        rows = [r for r in json.loads(monthly_json) if len(r) > 2 and r[2] is not None]
        year, month = max((int(r[0]), int(r[1])) for r in rows)
    except (ValueError, TypeError, IndexError):
        return None
    return f"{year:04d}-{month:02d}"


def _view(term: str, m: KeywordMetric, now: dt.datetime) -> MetricView:
    return MetricView(term, m.search_volume, m.cpc, m.competition, m.difficulty, m.intent, m.measured_at, fresh=m.expires_at > now, monthly=_series(m.monthly_json), last_month=_last_month(m.monthly_json))


def peek(db: Session, terms: list[str], *, market: str | None = None, language: str | None = None) -> dict[str, MetricView]:
    """Yalnızca OKUR: havuzda ölçümü olan kelimelerin en yeni ölçümü (kelime eklemez, kuyruğa almaz, commit etmez)."""
    market, language = _market(market, language)
    rows = pool.find_terms(db, terms, language)
    latest = pool.latest_metrics(db, [r.id for r in rows.values()], market, language)
    now = dt.datetime.utcnow()
    return {term: _view(term, latest[row.id], now) for term, row in rows.items() if row.id in latest}


def peek_containing(db: Session, term: str, *, market: str | None = None, language: str | None = None, limit: int = 300) -> dict[str, MetricView]:
    """Yalnızca OKUR: havuzda ölçümü olan, `term`in sözcüklerini içeren kelimeler (hacmi çoktan aza, en çok `limit`)."""
    market, language = _market(market, language)
    rows = pool.containing_terms(db, normalize(term), language, limit)
    latest = pool.latest_metrics(db, [r.id for r in rows], market, language)
    now = dt.datetime.utcnow()
    views = [_view(r.term, latest[r.id], now) for r in rows if r.id in latest and latest[r.id].search_volume is not None]
    views.sort(key=lambda v: -(v.search_volume or 0))
    return {v.term: v for v in views[:limit]}


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


def expand(
    db: Session, seed: str, *, market: str | None = None, language: str | None = None, shop_id: int | None = None, limit: int = 100, questions: bool = False,
    force: bool = False,
) -> Lookup:
    """Tohum kelimenin önerileri (havuzdan); `questions`: yalnızca soru kalıpları. Daha önce genişletilmediyse ya da süresi dolduysa iş kuyruğa alınır.
    `force`: süresi dolmasını beklemeden yeniden araştır (aynı tohum için saatte en çok bir kez); sonuç listesi yenisiyle DEĞİŞTİRİLİR. Çalışan bir iş varsa
    (hangi yoldan açılmış olursa olsun) `pending` işaretlenir, böylece ekran bitene kadar yoklar."""
    market, language = _market(market, language)
    term = normalize(seed)
    out = Lookup()
    relation = "question" if questions else "suggestion"
    if not researchable(term):
        return out
    rows = pool.get_or_create_terms(db, [term], language, "suggestion")
    seed_row = rows[term]
    pool.touch(db, [seed_row.id])
    now = dt.datetime.utcnow()
    related = db.scalars(
        select(KeywordTerm).join(KeywordLink, KeywordLink.keyword_id == KeywordTerm.id)
        .where(KeywordLink.seed_id == seed_row.id, KeywordLink.relation == relation).order_by(KeywordLink.rank)
    ).all()
    latest = pool.latest_metrics(db, [r.id for r in related], market, language)
    for r in related:
        if r.id in latest:
            out.metrics[r.term] = _view(r.term, latest[r.id], now)
    # Listenin yaşı: ilişkilerin son görülme zamanı (ölçüm satırlarının tarihi değil; taze kelimeler için yeni ölçüm satırı eklenmez).
    observed = db.scalar(select(func.max(KeywordLink.observed_at)).where(KeywordLink.seed_id == seed_row.id, KeywordLink.relation == relation))
    ttl = dt.timedelta(days=float(policy.get("research_ttl_suggest_days")))
    key = f"{'questions' if questions else 'suggest'}:{market}:{language}:{term}"
    refresh_key = f"{key}:r{int(now.timestamp() // 3600)}"
    payload = {"seed": term, "limit": limit, "questions": questions}
    if jobs.active_by_key(db, key) or jobs.active_by_key(db, refresh_key):
        out.pending = 1  # çalışan iş var: ekran bitene kadar yoklasın
    elif force and not jobs.done_since(db, refresh_key, now - dt.timedelta(hours=1)):
        out.pending, out.refused = _enqueue_suggest(db, refresh_key, payload, market, language, shop_id)
    elif (observed is None or now - observed > ttl) and not jobs.done_since(db, key, now - ttl):
        out.pending, out.refused = _enqueue_suggest(db, key, payload, market, language, shop_id)
    db.commit()
    return out


def _enqueue_suggest(db: Session, key: str, payload: dict, market: str, language: str, shop_id: int | None) -> tuple[int, str | None]:
    """(bekleyen iş sayısı, reddedilme nedeni)."""
    refused = _available(db, market)
    if refused is not None:
        return 0, refused
    try:
        jobs.enqueue(db, kind="suggest", provider=DEFAULT_PROVIDER, market=market, language=language, key=key, payload=payload, shop_id=shop_id)
        return 1, None
    except budget.QueueRefused as exc:
        return 0, exc.reason


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
        select(KeywordTerm).where(KeywordTerm.language == language, KeywordTerm.last_used_at >= since).order_by(KeywordTerm.last_used_at.desc()).limit(limit * 5)
    ).all()
    latest = pool.latest_metrics(db, [c.id for c in candidates], market, language)
    due = [c.term for c in candidates if c.id not in latest or latest[c.id].expires_at <= now][:limit]
    if due:
        _enqueue_volumes(db, due, market, language, None)
    db.commit()
    return len(due)

"""Yönetim ekranları için havuz sorguları (yalnızca okuma + küçük işlemler). Ham sayısal tablolar yalnızca burada, yalnızca yöneticiye gider."""
import calendar
import datetime as dt
import json
import statistics
from collections import Counter

from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core import app_settings
from app.core.dates import iso
from app.insights.models import EtsyKeywordData
from app.research import alerts, budget, credentials, exposure, outcomes, policy, pool
from app.research.admin_pool import PER_PAGE, KeywordRowOut, etsy_shop_counts, row_out
from app.research import jobs as queue
from app.research.models import KeywordLink, KeywordMetric, KeywordTerm, ProviderCall, ResearchJob
from app.research.providers import DEFAULT_PROVIDER



class AlertOut(BaseModel):
    """Yönetim uyarısı (bkz. alerts.py). Metni arayüz iki dilde üretir; `value`/`limit` anlamı ana anahtara göre değişir (yüzde, dakika, sayı, tutar)."""

    key: str
    level: str  # warn | bad
    value: float | None
    limit: float | None


class OverviewOut(BaseModel):
    terms: int
    metrics: int
    fresh_terms: int
    new_terms_24h: int
    jobs: dict[str, int]
    calls_24h: int
    errors_24h: int
    spend_month: float
    budget_month: float
    credentials: str  # none | database | env
    enabled: bool
    alerts: list[AlertOut]


class MetricOut(BaseModel):
    source: str
    market: str
    search_volume: int | None
    cpc: float | None
    competition: float | None
    difficulty: int | None
    intent: str | None
    monthly: list[list[int]] | None
    measured_at: str
    expires_at: str


class RelatedOut(BaseModel):
    term: str
    search_volume: int | None
    relation: str


class SignalsOut(BaseModel):
    """Ortak sinyaller (yalnızca sayı): kaç mağazaya önerildi, kaçında uygulandı, ölçülen sonuçlar."""

    suggested_shops: int
    applied: int
    measured: int
    better: int
    worse: int
    same: int
    unclear: int
    low_data: int


class EtsyInsightsOut(BaseModel):
    """Mağazaların Marketplace Insights'tan yapıştırdığı verinin özeti (mağaza başına en yeni yapıştırma). Yalnızca toplu sayılar, mağaza kimliği yok;
    kullanıcı kaynaklı olduğu için havuzdaki Google ölçümünden ayrı gösterilir ve ona karıştırılmaz."""

    shops: int
    searches_min: int | None
    searches_median: int | None
    searches_max: int | None
    results_median: int | None
    trend_median: int | None
    conversion: str | None  # en sık görülen dönüşüm bandı
    latest_on: str | None


class KeywordDetailOut(BaseModel):
    keyword: KeywordRowOut
    etsy: EtsyInsightsOut | None
    signals: SignalsOut
    history: list[MetricOut]
    related: list[RelatedOut]
    seeds: list[str]


class JobOut(BaseModel):
    id: int
    kind: str
    market: str
    language: str
    status: str
    attempts: int
    shop_id: int | None
    cost_usd: float
    error: str
    items: int
    created_at: str
    finished_at: str | None
    run_after: str


class JobsPageOut(BaseModel):
    items: list[JobOut]
    total: int
    page: int
    per_page: int


class CostDayOut(BaseModel):
    day: str
    cost_usd: float
    calls: int
    errors: int


class CostEndpointOut(BaseModel):
    endpoint: str
    cost_usd: float
    calls: int
    errors: int


class CostOut(BaseModel):
    days: list[CostDayOut]  # eksik günler 0 ile doldurulur (grafik kesintisiz)
    by_endpoint: list[CostEndpointOut]
    month_spend: float
    month_budget: float
    projected_month: float  # bu ayın şu ana kadarki gidişine göre ay sonu tahmini


class CallOut(BaseModel):
    id: int
    endpoint: str
    market: str
    items: int
    cost_usd: float
    duration_ms: int
    ok: bool
    error: str
    created_at: str


def overview(db: Session) -> OverviewOut:
    now = dt.datetime.utcnow()
    day = now - dt.timedelta(days=1)
    by_status = dict(db.execute(select(ResearchJob.status, func.count()).group_by(ResearchJob.status)).all())
    return OverviewOut(
        terms=db.scalar(select(func.count(KeywordTerm.id))) or 0,
        metrics=db.scalar(select(func.count(KeywordMetric.id))) or 0,
        fresh_terms=db.scalar(select(func.count(func.distinct(KeywordMetric.keyword_id))).where(KeywordMetric.expires_at > now)) or 0,
        new_terms_24h=db.scalar(select(func.count(KeywordTerm.id)).where(KeywordTerm.created_at >= day)) or 0,
        jobs={k: int(v) for k, v in by_status.items()},
        calls_24h=db.scalar(select(func.count(ProviderCall.id)).where(ProviderCall.created_at >= day)) or 0,
        errors_24h=db.scalar(select(func.count(ProviderCall.id)).where(ProviderCall.created_at >= day, ProviderCall.ok.is_(False))) or 0,
        spend_month=round(budget.month_spend(db), 4),
        budget_month=float(policy.get("research_monthly_budget_usd")),
        credentials=credentials.source(db, DEFAULT_PROVIDER),
        enabled=bool(policy.get("research_enabled")),
        alerts=[AlertOut(key=a.key, level=a.level, value=a.value, limit=a.limit) for a in alerts.compute(db)],
    )


def etsy_insights(db: Session, term: str) -> EtsyInsightsOut | None:
    """Mağaza başına en yeni Marketplace Insights yapıştırması; hiç yoksa None."""
    rows = db.scalars(
        select(EtsyKeywordData).where(EtsyKeywordData.source == "marketplace_insights", EtsyKeywordData.keyword == term)
        .order_by(EtsyKeywordData.captured_on.desc(), EtsyKeywordData.id.desc())
    ).all()
    latest: dict[int, EtsyKeywordData] = {}
    for r in rows:
        latest.setdefault(r.shop_id, r)
    if not latest:
        return None
    picked = list(latest.values())

    def values(field: str) -> list[int]:
        return [v for v in (getattr(r, field) for r in picked) if v is not None]

    def median(vs: list[int]) -> int | None:
        return int(statistics.median_low(vs)) if vs else None

    searches = values("searches")
    bands = Counter(r.conversion for r in picked if r.conversion)
    return EtsyInsightsOut(
        shops=len(picked), searches_min=min(searches) if searches else None, searches_median=median(searches), searches_max=max(searches) if searches else None,
        results_median=median(values("listings_count")), trend_median=median(values("trend_pct")),
        conversion=bands.most_common(1)[0][0] if bands else None, latest_on=picked[0].captured_on.isoformat(),
    )


def keyword_detail(db: Session, keyword_id: int, market: str) -> KeywordDetailOut | None:
    kw = db.get(KeywordTerm, keyword_id)
    if kw is None:
        return None
    now = dt.datetime.utcnow()
    history = db.scalars(
        select(KeywordMetric).where(KeywordMetric.keyword_id == kw.id, KeywordMetric.language == kw.language).order_by(KeywordMetric.measured_at.desc()).limit(50)
    ).all()
    current = next((m for m in history if m.market == market), None)
    related_rows = db.execute(
        select(KeywordTerm, KeywordLink.relation).join(KeywordLink, KeywordLink.keyword_id == KeywordTerm.id)
        .where(KeywordLink.seed_id == kw.id).order_by(KeywordLink.rank).limit(30)
    ).all()
    latest = pool.latest_metrics(db, [r.id for r, _ in related_rows], market, kw.language)
    seeds = db.scalars(select(KeywordTerm.term).join(KeywordLink, KeywordLink.seed_id == KeywordTerm.id).where(KeywordLink.keyword_id == kw.id).limit(20)).all()
    oc = outcomes.for_term(db, kw.term)
    signals = SignalsOut(
        suggested_shops=exposure.counts(db, [kw.term]).get(kw.term, 0), applied=oc.applied if oc else 0, measured=oc.measured if oc else 0,
        better=oc.better if oc else 0, worse=oc.worse if oc else 0, same=oc.same if oc else 0, unclear=oc.unclear if oc else 0, low_data=oc.low_data if oc else 0,
    )
    return KeywordDetailOut(
        keyword=row_out(kw, current, now, etsy_shop_counts(db, [kw.term]).get(kw.term, 0)), etsy=etsy_insights(db, kw.term), signals=signals,
        history=[MetricOut(
            source=m.source, market=m.market, search_volume=m.search_volume, cpc=m.cpc, competition=m.competition, difficulty=m.difficulty, intent=m.intent,
            monthly=json.loads(m.monthly_json) if m.monthly_json else None, measured_at=iso(m.measured_at), expires_at=iso(m.expires_at),
        ) for m in history],
        related=[RelatedOut(term=r.term, search_volume=latest[r.id].search_volume if r.id in latest else None, relation=rel) for r, rel in related_rows],
        seeds=list(seeds),
    )


def _job_out(job: ResearchJob) -> JobOut:
    p = queue.params(job)
    return JobOut(
        id=job.id, kind=job.kind, market=job.market, language=job.language, status=job.status, attempts=job.attempts, shop_id=job.shop_id,
        cost_usd=float(job.cost_usd or 0), error=job.error, items=len(p.get("terms", [])) or (1 if p.get("seed") else 0),
        created_at=iso(job.created_at), finished_at=iso(job.finished_at) if job.finished_at else None, run_after=iso(job.run_after),
    )


def jobs_page(db: Session, *, status: str, page: int) -> JobsPageOut:
    q = select(ResearchJob)
    if status:
        q = q.where(ResearchJob.status == status)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(ResearchJob.id.desc()).limit(PER_PAGE).offset((page - 1) * PER_PAGE)).all()
    return JobsPageOut(items=[_job_out(j) for j in rows], total=total, page=page, per_page=PER_PAGE)


def recent_calls(db: Session) -> list[CallOut]:
    rows = db.scalars(select(ProviderCall).order_by(ProviderCall.id.desc()).limit(PER_PAGE)).all()
    return [CallOut(
        id=c.id, endpoint=c.endpoint, market=c.market, items=c.items, cost_usd=float(c.cost_usd or 0), duration_ms=c.duration_ms, ok=c.ok, error=c.error,
        created_at=iso(c.created_at),
    ) for c in rows]


def cost_report(db: Session, days: int = 30) -> CostOut:
    """Son `days` günün günlük ve uç nokta bazlı maliyeti + bu ayın gidişine göre ay sonu tahmini."""
    now = dt.datetime.utcnow()
    since = (now - dt.timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    day = func.date(ProviderCall.created_at)
    failed = func.sum(case((ProviderCall.ok.is_(False), 1), else_=0))
    per_day = {
        str(d): CostDayOut(day=str(d), cost_usd=round(float(c or 0), 4), calls=int(n), errors=int(e or 0))
        for d, c, n, e in db.execute(
            select(day, func.sum(ProviderCall.cost_usd), func.count(), failed).where(ProviderCall.created_at >= since).group_by(day)
        ).all()
    }
    series = []
    for i in range(days):
        d = (since + dt.timedelta(days=i)).date().isoformat()
        series.append(per_day.get(d) or CostDayOut(day=d, cost_usd=0, calls=0, errors=0))
    by_endpoint = [
        CostEndpointOut(endpoint=ep, cost_usd=round(float(c or 0), 4), calls=int(n), errors=int(e or 0))
        for ep, c, n, e in db.execute(
            select(ProviderCall.endpoint, func.sum(ProviderCall.cost_usd), func.count(), failed)
            .where(ProviderCall.created_at >= since).group_by(ProviderCall.endpoint).order_by(func.sum(ProviderCall.cost_usd).desc())
        ).all()
    ]
    spend = budget.month_spend(db)
    elapsed = max(1.0, (now - budget.month_start(now)).total_seconds() / 86400)
    projected = spend / elapsed * calendar.monthrange(now.year, now.month)[1]
    return CostOut(
        days=series, by_endpoint=by_endpoint, month_spend=round(spend, 4), month_budget=float(policy.get("research_monthly_budget_usd")),
        projected_month=round(max(projected, spend), 4),
    )


def settings_validate(values: dict) -> dict:
    """Yalnızca bilinen anahtarlar, türüne göre doğrulanmış. Hatalıysa ValueError."""
    clean = {}
    for key, value in values.items():
        if key not in policy.DEFAULTS:
            raise ValueError(f"Bilinmeyen ayar: {key}")
        default = policy.DEFAULTS[key]
        if isinstance(default, bool):
            clean[key] = bool(value)
        elif isinstance(default, int):
            clean[key] = int(value)
            if clean[key] < 0:
                raise ValueError(f"{key} negatif olamaz")
        elif isinstance(default, float):
            clean[key] = float(value)
            if clean[key] < 0:
                raise ValueError(f"{key} negatif olamaz")
        else:
            clean[key] = str(value).strip()
    if "research_default_market" in clean:
        clean["research_default_market"] = clean["research_default_market"].upper()
    return clean


def save_settings(db: Session, values: dict) -> dict:
    app_settings.set_many(db, settings_validate(values))
    return policy.snapshot()

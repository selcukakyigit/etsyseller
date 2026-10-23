"""Yönetim ekranları için havuz sorguları (yalnızca okuma + küçük işlemler). Ham sayısal tablolar yalnızca burada, yalnızca yöneticiye gider."""
import datetime as dt
import json

from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core import app_settings
from app.core.dates import iso
from app.research import budget, credentials, policy, pool
from app.research.models import KeywordLink, KeywordMetric, KeywordTerm, ProviderCall, ResearchJob
from app.research.providers import DEFAULT_PROVIDER

PER_PAGE = 50


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


class KeywordRowOut(BaseModel):
    id: int
    term: str
    language: str
    first_source: str
    created_at: str
    last_used_at: str | None
    market: str | None
    search_volume: int | None
    cpc: float | None
    competition: float | None
    difficulty: int | None
    intent: str | None
    measured_at: str | None
    state: str  # fresh | stale | missing


class KeywordsPageOut(BaseModel):
    items: list[KeywordRowOut]
    total: int
    page: int
    per_page: int


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


class KeywordDetailOut(BaseModel):
    keyword: KeywordRowOut
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
    )


def _row(kw: KeywordTerm, m: KeywordMetric | None, now: dt.datetime) -> KeywordRowOut:
    state = "missing" if m is None else "fresh" if m.expires_at > now else "stale"
    return KeywordRowOut(
        id=kw.id, term=kw.term, language=kw.language, first_source=kw.first_source, created_at=iso(kw.created_at), last_used_at=iso(kw.last_used_at) if kw.last_used_at else None,
        market=m.market if m else None, search_volume=m.search_volume if m else None, cpc=m.cpc if m else None, competition=m.competition if m else None,
        difficulty=m.difficulty if m else None, intent=m.intent if m else None, measured_at=iso(m.measured_at) if m else None, state=state,
    )


def keywords(db: Session, *, q: str, state: str, market: str, language: str, page: int) -> KeywordsPageOut:
    now = dt.datetime.utcnow()
    newest = (
        select(KeywordMetric.keyword_id, func.max(KeywordMetric.measured_at).label("m"))
        .where(KeywordMetric.market == market, KeywordMetric.language == language).group_by(KeywordMetric.keyword_id).subquery()
    )
    base = (
        select(KeywordTerm, KeywordMetric)
        .outerjoin(newest, newest.c.keyword_id == KeywordTerm.id)
        .outerjoin(KeywordMetric, (KeywordMetric.keyword_id == newest.c.keyword_id) & (KeywordMetric.measured_at == newest.c.m)
                   & (KeywordMetric.market == market) & (KeywordMetric.language == language))
        .where(KeywordTerm.language == language)
    )
    if q.strip():
        base = base.where(KeywordTerm.term.like(f"%{q.strip().lower()}%"))
    if state == "missing":
        base = base.where(KeywordMetric.id.is_(None))
    elif state == "fresh":
        base = base.where(KeywordMetric.expires_at > now)
    elif state == "stale":
        base = base.where(KeywordMetric.expires_at <= now)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.execute(base.order_by(KeywordTerm.id.desc()).limit(PER_PAGE).offset((page - 1) * PER_PAGE)).all()
    return KeywordsPageOut(items=[_row(k, m, now) for k, m in rows], total=total, page=page, per_page=PER_PAGE)


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
    return KeywordDetailOut(
        keyword=_row(kw, current, now),
        history=[MetricOut(
            source=m.source, market=m.market, search_volume=m.search_volume, cpc=m.cpc, competition=m.competition, difficulty=m.difficulty, intent=m.intent,
            monthly=json.loads(m.monthly_json) if m.monthly_json else None, measured_at=iso(m.measured_at), expires_at=iso(m.expires_at),
        ) for m in history],
        related=[RelatedOut(term=r.term, search_volume=latest[r.id].search_volume if r.id in latest else None, relation=rel) for r, rel in related_rows],
        seeds=list(seeds),
    )


def _job_out(job: ResearchJob) -> JobOut:
    from app.research import jobs as queue

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


def daily_cost(db: Session, days: int = 30) -> list[dict]:
    since = dt.datetime.utcnow() - dt.timedelta(days=days)
    day = func.date(ProviderCall.created_at)
    rows = db.execute(
        select(day, func.sum(ProviderCall.cost_usd), func.count(), func.sum(case((ProviderCall.ok.is_(False), 1), else_=0)))
        .where(ProviderCall.created_at >= since).group_by(day).order_by(day)
    ).all()
    return [{"day": str(d), "cost_usd": round(float(c or 0), 4), "calls": int(n), "errors": int(e or 0)} for d, c, n, e in rows]


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

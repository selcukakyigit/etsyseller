"""Yönetim > Araştırma: havuzdaki kelimelerin listesi, süzgeçleri, toplu işlemleri ve dışa aktarması. Liste, ölçtürme, toplu işlem ve dışa aktarma AYNI
`KeywordFilters` ile çalışır: ekranda görünen liste ile "bunların hepsine uygula" dediğiniz küme her zaman aynıdır."""
import csv
import datetime as dt
import io
from collections.abc import Iterator

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.dates import iso
from app.insights.models import EtsyKeywordData, TrackedKeyword
from app.research import policy, pool, service
from app.research import jobs as queue
from app.research.providers import get_provider
from app.research.models import KeywordLink, KeywordMetric, KeywordSeason, KeywordTerm, KeywordTrend, ResearchJob, SavedKeyword

PER_PAGE = 50
TOTAL_CAP = 10_000  # sayım bu kadar satırda durur ("10.000+"): büyük havuzda her sayfada tüm tabloyu saymayalım
BULK_MAX = 1000  # tek işlemde en fazla kelime (sağlayıcının tek istek sınırı da bu)
EXPORT_MAX = 10_000
BULK_ACTIONS = ("refresh", "pin", "unpin", "block", "unblock", "archive", "unarchive", "delete")
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")  # Excel/Sheets'te formül sayılan başlangıçlar


class KeywordFilters(BaseModel):
    """Yönetim kelime listesinin süzgeci. Boş değer = süzgeç yok. `market`/`language` boşsa araştırma varsayılanı kullanılır."""

    q: str = Field("", max_length=120)
    state: str = Field("", pattern="^(|fresh|stale|missing)$")
    source: str = Field("", max_length=30)
    etsy: bool = False
    status: str = Field("", pattern="^(|active|archived|blocked)$")
    pinned: str = Field("", pattern="^(|yes|no)$")
    intent: str = Field("", pattern="^(|informational|navigational|commercial|transactional)$")
    min_volume: int | None = Field(None, ge=0)
    max_volume: int | None = Field(None, ge=0)
    expiring_days: int | None = Field(None, ge=1, le=365)  # güncel ölçümü önümüzdeki N gün içinde dolacaklar
    unused_days: int | None = Field(None, ge=1, le=3650)  # N gündür (ya da hiç) kullanılmamışlar
    market: str = Field("", max_length=2)
    language: str = Field("", max_length=8)

    def resolved(self) -> tuple[str, str]:
        return (self.market.upper() or policy.get("research_default_market")), (self.language.lower() or policy.get("research_default_language"))


class KeywordRowOut(BaseModel):
    id: int
    term: str
    language: str
    first_source: str
    created_at: str
    last_used_at: str | None
    status: str  # active | archived | blocked
    pinned: bool
    market: str | None
    search_volume: int | None
    cpc: float | None
    competition: float | None
    difficulty: int | None
    intent: str | None
    measured_at: str | None
    expires_at: str | None
    state: str  # fresh | stale | missing
    # Yalnızca state == missing: queued (iş sırada) | failed (iş başarısız/vazgeçildi) | other_market (başka pazarda ölçülmüş) | none (hiç istenmemiş)
    reason: str = ""
    reason_detail: str = ""  # failed: hata mesajı; other_market: pazarlar
    etsy_shops: int = 0  # kaç mağaza bu kelimeyi Marketplace Insights'tan yapıştırmış (yalnızca sayı)


class KeywordsPageOut(BaseModel):
    items: list[KeywordRowOut]
    total: int  # TOTAL_CAP'te durur
    capped: bool = False  # true: gerçek sayı `total`dan büyük ("10.000+")
    page: int
    per_page: int


class BulkIn(BaseModel):
    """Toplu işlem: ya seçili `ids` ya da süzgece uyan kelimelerin hepsi (`filters`, en çok BULK_MAX). İkisi birden ya da hiçbiri olamaz."""

    action: str = Field(pattern="^(" + "|".join(BULK_ACTIONS) + ")$")
    ids: list[int] | None = Field(None, min_length=1, max_length=BULK_MAX)
    filters: KeywordFilters | None = None

    @model_validator(mode="after")
    def _one_target(self):
        if (self.ids is None) == (self.filters is None):
            raise ValueError("ids ya da filters verilmeli (yalnızca biri)")
        return self


class BulkOut(BaseModel):
    matched: int  # işleme giren kelime sayısı
    changed: int  # gerçekten değişen (zaten o durumda olanlar sayılmaz)
    skipped: int = 0  # delete: kaydedilmiş / takipteki kelimeler silinmez
    pending: int = 0  # refresh: kuyruğa alınan
    requests: int = 0  # refresh: sağlayıcıya gidecek istek sayısı (ücret istek başınadır)
    refused: str | None = None  # refresh: kuyruğa alınamadıysa nedeni


def row_out(kw: KeywordTerm, m: KeywordMetric | None, now: dt.datetime, etsy_shops: int = 0, reason: tuple[str, str] = ("", "")) -> KeywordRowOut:
    state = "missing" if m is None else "fresh" if m.expires_at > now else "stale"
    return KeywordRowOut(
        id=kw.id, term=kw.term, language=kw.language, first_source=kw.first_source, created_at=iso(kw.created_at), last_used_at=iso(kw.last_used_at) if kw.last_used_at else None,
        status=kw.status, pinned=bool(kw.pinned), market=m.market if m else None, search_volume=m.search_volume if m else None, cpc=m.cpc if m else None,
        competition=m.competition if m else None, difficulty=m.difficulty if m else None, intent=m.intent if m else None, measured_at=iso(m.measured_at) if m else None,
        expires_at=iso(m.expires_at) if m else None, state=state, etsy_shops=etsy_shops, reason=reason[0], reason_detail=reason[1],
    )


SORTS = {
    "new": lambda: (KeywordTerm.id.desc(),),
    "volume": lambda: (KeywordMetric.search_volume.desc().nulls_last(), KeywordTerm.id.desc()),
    "cpc": lambda: (KeywordMetric.cpc.desc().nulls_last(), KeywordTerm.id.desc()),
    "difficulty": lambda: (KeywordMetric.difficulty.desc().nulls_last(), KeywordTerm.id.desc()),
    "measured": lambda: (KeywordMetric.measured_at.desc().nulls_last(), KeywordTerm.id.desc()),
    "expires": lambda: (KeywordMetric.expires_at.asc().nulls_last(), KeywordTerm.id.desc()),  # önce yenilenmesi en yakın olan
    "used": lambda: (KeywordTerm.last_used_at.desc().nulls_last(), KeywordTerm.id.desc()),
}
SORT_PATTERN = "^(" + "|".join(SORTS) + ")$"


class KeywordListQuery(KeywordFilters):
    """Liste uç noktasının sorgusu: süzgeç + sıralama + sayfa (FastAPI sorgu modelini başka sorgu parametreleriyle karıştırmaya izin vermez)."""

    sort: str = Field("new", pattern=SORT_PATTERN)
    page: int = Field(1, ge=1)


def etsy_shop_counts(db: Session, terms: list[str]) -> dict[str, int]:
    rows = db.execute(
        select(EtsyKeywordData.keyword, func.count(func.distinct(EtsyKeywordData.shop_id)))
        .where(EtsyKeywordData.source == "marketplace_insights", EtsyKeywordData.keyword.in_(terms)).group_by(EtsyKeywordData.keyword)
    ).all()
    return {k: int(n) for k, n in rows}


def keyword_base(f: KeywordFilters, now: dt.datetime):
    market, language = f.resolved()
    base = (
        select(KeywordTerm, KeywordMetric)
        .outerjoin(
            KeywordMetric,
            (KeywordMetric.keyword_id == KeywordTerm.id) & (KeywordMetric.market == market) & (KeywordMetric.language == language) & KeywordMetric.is_latest.is_(True),
        )
        .where(KeywordTerm.language == language)
    )
    if f.q.strip():
        base = base.where(KeywordTerm.term.contains(f.q.strip().lower(), autoescape=True))
    if f.source:
        base = base.where(KeywordTerm.first_source == f.source)
    if f.etsy:
        base = base.where(KeywordTerm.term.in_(select(EtsyKeywordData.keyword).where(EtsyKeywordData.source == "marketplace_insights")))
    if f.status:
        base = base.where(KeywordTerm.status == f.status)
    if f.pinned:
        base = base.where(KeywordTerm.pinned.is_(f.pinned == "yes"))
    if f.intent:
        base = base.where(KeywordMetric.intent == f.intent)
    if f.min_volume is not None:
        base = base.where(KeywordMetric.search_volume >= f.min_volume)
    if f.max_volume is not None:
        base = base.where(KeywordMetric.search_volume <= f.max_volume)
    if f.expiring_days:
        base = base.where(KeywordMetric.expires_at > now, KeywordMetric.expires_at <= now + dt.timedelta(days=f.expiring_days))
    if f.unused_days:
        base = base.where(or_(KeywordTerm.last_used_at.is_(None), KeywordTerm.last_used_at < now - dt.timedelta(days=f.unused_days)))
    if f.state == "missing":
        base = base.where(KeywordMetric.id.is_(None))
    elif f.state == "fresh":
        base = base.where(KeywordMetric.expires_at > now)
    elif f.state == "stale":
        base = base.where(KeywordMetric.expires_at <= now)
    return base


def _missing_reasons(db: Session, terms: list[str], market: str, language: str) -> dict[str, tuple[str, str]]:
    """Ölçümü olmayan kelimelerin NEDEN olmadığı: iş sırada mı, başarısız mı, başka pazarda mı ölçülmüş, hiç istenmemiş mi."""
    wanted = set(terms)
    out = {t: ("none", "") for t in terms}
    markets: dict[str, list[str]] = {}
    for term, other in db.execute(
        select(KeywordTerm.term, KeywordMetric.market).join(KeywordMetric, KeywordMetric.keyword_id == KeywordTerm.id)
        .where(KeywordTerm.language == language, KeywordTerm.term.in_(wanted), KeywordMetric.market != market).distinct()
    ):
        markets.setdefault(term, []).append(other)
    for term, found in markets.items():
        out[term] = ("other_market", ", ".join(sorted(found)))
    recent = db.scalars(
        select(ResearchJob).where(
            ResearchJob.market == market, ResearchJob.language == language, ResearchJob.status.in_(("queued", "running", "failed", "dead")),
            ResearchJob.kind.in_(("volume", "suggest", "trend")),
        ).order_by(ResearchJob.id.desc()).limit(500)
    ).all()
    seen: dict[str, tuple[str, str]] = {}
    for job in recent:  # en yeniden eskiye; sıradaki iş, başarısız eski işten önce gelir
        p = queue.params(job)
        names = set(p.get("terms", [])) | ({p["seed"]} if p.get("seed") else set())
        status = "queued" if job.status in queue.ACTIVE else "failed"
        for term in names & wanted:
            if term not in seen or (status == "queued" and seen[term][0] != "queued"):
                seen[term] = (status, job.error[:200] if status == "failed" else "")
    out.update(seen)
    return out


def keywords(db: Session, f: KeywordFilters, *, page: int, sort: str = "new") -> KeywordsPageOut:
    now = dt.datetime.utcnow()
    market, language = f.resolved()
    base = keyword_base(f, now)
    counted = db.scalar(select(func.count()).select_from(base.limit(TOTAL_CAP + 1).subquery())) or 0
    rows = db.execute(base.order_by(*SORTS.get(sort, SORTS["new"])()).limit(PER_PAGE).offset((page - 1) * PER_PAGE)).all()
    shops = etsy_shop_counts(db, [k.term for k, _ in rows])
    missing = [k.term for k, m in rows if m is None]
    reasons = _missing_reasons(db, missing, market, language) if missing else {}
    return KeywordsPageOut(
        items=[row_out(k, m, now, shops.get(k.term, 0), reasons.get(k.term, ("", ""))) for k, m in rows],
        total=min(counted, TOTAL_CAP), capped=counted > TOTAL_CAP, page=page, per_page=PER_PAGE,
    )


def matching_terms(db: Session, f: KeywordFilters, limit: int = BULK_MAX) -> list[KeywordTerm]:
    """Süzgece uyan kelime satırları (en çok `limit`), sayfalamadan bağımsız; toplu işlem ve ölçtürme bunu kullanır."""
    base = keyword_base(f, dt.datetime.utcnow())
    return [k for k, _ in db.execute(base.order_by(KeywordTerm.id.desc()).limit(limit)).all()]


# ---- Toplu işlem


def _protected_terms(db: Session, terms: list[str]) -> set[str]:
    """Silinemeyecek kelimeler: bir çalışma alanının kaydettiği ya da sıra takibindeki (kiracı verisi havuzdan sessizce kaybolmasın)."""
    protected = {t for (t,) in db.execute(select(SavedKeyword.term).where(SavedKeyword.term.in_(terms)))}
    protected |= {t for (t,) in db.execute(select(TrackedKeyword.keyword).where(TrackedKeyword.keyword.in_(terms)))}
    return protected


def _delete(db: Session, rows: list[KeywordTerm]) -> tuple[int, int]:
    """(silinen, atlanan). Ölçümler, trendler, mevsimsellik ve ilişkiler de silinir."""
    protected = _protected_terms(db, [r.term for r in rows])
    ids = [r.id for r in rows if r.term not in protected]
    if ids:
        db.execute(delete(KeywordMetric).where(KeywordMetric.keyword_id.in_(ids)))
        db.execute(delete(KeywordTrend).where(KeywordTrend.keyword_id.in_(ids)))
        db.execute(delete(KeywordSeason).where(KeywordSeason.keyword_id.in_(ids)))
        db.execute(delete(KeywordLink).where(or_(KeywordLink.seed_id.in_(ids), KeywordLink.keyword_id.in_(ids))))
        db.execute(delete(KeywordTerm).where(KeywordTerm.id.in_(ids)))
    return len(ids), len(rows) - len(ids)


def _set(db: Session, rows: list[KeywordTerm], **values) -> int:
    changed = [r.id for r in rows if any(getattr(r, k) != v for k, v in values.items())]
    if changed:
        db.execute(update(KeywordTerm).where(KeywordTerm.id.in_(changed)).values(**values))
    return len(changed)


def pin_terms(db: Session, terms: list[str], language: str | None = None) -> int:
    """Kelime ekleme penceresindeki "sabitle" seçeneği: verilen kelimeleri (engelli olmayanları) sabitler; sabitlenen sayıyı döner."""
    rows = [r for r in pool.find_terms(db, terms, language or policy.get("research_default_language")).values() if r.status != "blocked"]
    changed = _set(db, rows, pinned=True)
    db.commit()
    return changed


def apply_bulk(db: Session, payload: BulkIn) -> BulkOut:
    if payload.ids is not None:
        rows = list(db.scalars(select(KeywordTerm).where(KeywordTerm.id.in_(payload.ids))))
    else:
        rows = matching_terms(db, payload.filters)
    out = BulkOut(matched=len(rows), changed=0)
    if not rows:
        return out
    action = payload.action
    if action == "refresh":
        market, language = payload.filters.resolved() if payload.filters else (None, None)
        live = [r for r in rows if r.status != "blocked"]
        by_language: dict[str, list[str]] = {}
        for r in live:
            by_language.setdefault(r.language, []).append(r.term)
        for lang, terms in by_language.items():
            result = service.request_refresh(db, terms, market=market, language=lang)
            out.pending += result.pending
            out.refused = out.refused or result.refused
        out.changed = out.pending
        out.requests = -(-out.pending // get_provider().max_volume_terms) if out.pending else 0
        out.skipped = len(rows) - len(live)
    elif action == "pin":
        out.changed = _set(db, [r for r in rows if r.status != "blocked"], pinned=True)
    elif action == "unpin":
        out.changed = _set(db, rows, pinned=False)
    elif action == "block":
        out.changed = _set(db, rows, status="blocked", pinned=False)  # engelli kelime yenilenmez, sabitli kalamaz
    elif action == "unblock":
        out.changed = _set(db, [r for r in rows if r.status == "blocked"], status="active")
    elif action == "archive":
        out.changed = _set(db, [r for r in rows if r.status == "active"], status="archived")
    elif action == "unarchive":
        out.changed = _set(db, [r for r in rows if r.status == "archived"], status="active")
    elif action == "delete":
        out.changed, out.skipped = _delete(db, rows)
    db.commit()
    return out


# ---- Dışa aktarma

EXPORT_HEADER = [
    "term", "language", "market", "search_volume", "cpc_usd", "ad_competition_0_1", "seo_difficulty_0_100", "intent", "measured_at", "expires_at", "state",
    "status", "pinned", "first_source", "last_used_at",
]


def _safe(value) -> str:
    """CSV hücresi: formül olarak yorumlanabilecek başlangıçlar etkisizleştirilir (kelimeler kullanıcı girdisinden gelir)."""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_START) else text


def export_csv(db: Session, f: KeywordFilters) -> Iterator[str]:
    """Süzgece uyan kelimeler (en çok EXPORT_MAX), CSV parçaları olarak. Ham sağlayıcı sayıları içerir: yalnızca yönetici."""
    now = dt.datetime.utcnow()
    market, _ = f.resolved()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(EXPORT_HEADER)
    yield buf.getvalue()
    stream = db.execute(keyword_base(f, now).order_by(KeywordTerm.id.desc()).limit(EXPORT_MAX).execution_options(stream_results=True, yield_per=500))
    for kw, m in stream:
        buf.seek(0)
        buf.truncate()
        state = "missing" if m is None else "fresh" if m.expires_at > now else "stale"
        writer.writerow([_safe(v) for v in (
            kw.term, kw.language, m.market if m else market, m.search_volume if m else None, m.cpc if m else None, m.competition if m else None,
            m.difficulty if m else None, m.intent if m else None, iso(m.measured_at) if m else None, iso(m.expires_at) if m else None, state,
            kw.status, "yes" if kw.pinned else "no", kw.first_source, iso(kw.last_used_at) if kw.last_used_at else None,
        )])
        yield buf.getvalue()

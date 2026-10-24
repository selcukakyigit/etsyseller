"""Havuz deposu: kelime ve ölçüm okuma/yazma. Tek yer; worker, servis ve yönetim ekranı buradan geçer."""
import datetime as dt
import json

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.research import policy
from app.research.models import KeywordLink, KeywordMetric, KeywordSeason, KeywordTerm, KeywordTrend
from app.research.terms import normalize
from app.research.records import MetricRecord, SeasonRecord, TrendRecord

CHUNK = 500  # IN (...) listelerini bölmek için
MIN_TREND_INTEREST = 3.0  # geçen yılki ilgi bunun altındaysa (Google'da çok az aranıyorsa) yıllık değişim gürültüdür, hesaplanmaz


def _chunks(items: list, size: int = CHUNK):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def get_or_create_terms(db: Session, displays: list[str], language: str, source: str) -> dict[str, KeywordTerm]:
    """normalize edilmiş kelime -> satır. Olmayanlar eklenir; eşzamanlı ekleme (benzersiz çakışma) yeniden okunarak çözülür."""
    wanted: dict[str, str] = {}
    for text in displays:
        term = normalize(text)
        if term and term not in wanted:
            wanted[term] = text.strip()[:120]
    found: dict[str, KeywordTerm] = {}

    def load(terms: list[str]) -> None:
        for part in _chunks(terms):
            for row in db.scalars(select(KeywordTerm).where(KeywordTerm.language == language, KeywordTerm.term.in_(part))):
                found[row.term] = row

    load(list(wanted))
    missing = [t for t in wanted if t not in found]
    if missing:
        try:
            with db.begin_nested():
                db.add_all(KeywordTerm(term=t, display=wanted[t], language=language, first_source=source) for t in missing)
        except IntegrityError:
            load(missing)  # başka bir süreç aynı anda eklemiş; tek tek yeniden dene
            for t in [t for t in missing if t not in found]:
                try:
                    with db.begin_nested():
                        db.add(KeywordTerm(term=t, display=wanted[t], language=language, first_source=source))
                except IntegrityError:
                    pass
        load(missing)
    return found


def find_terms(db: Session, displays: list[str], language: str) -> dict[str, KeywordTerm]:
    """Yalnızca OKUR (kelime eklemez): normalize edilmiş kelime -> var olan satır."""
    wanted = list({normalize(t) for t in displays if normalize(t)})
    found: dict[str, KeywordTerm] = {}
    for part in _chunks(wanted):
        for row in db.scalars(select(KeywordTerm).where(KeywordTerm.language == language, KeywordTerm.term.in_(part))):
            found[row.term] = row
    return found


def touch(db: Session, ids: list[int]) -> None:
    now = dt.datetime.utcnow()
    for part in _chunks(ids):
        db.execute(update(KeywordTerm).where(KeywordTerm.id.in_(part)).values(last_used_at=now))


def latest_metrics(db: Session, ids: list[int], market: str, language: str) -> dict[int, KeywordMetric]:
    """Her kelimenin bu pazar/dildeki EN YENİ ölçümü (kaynağa bakılmaksızın)."""
    out: dict[int, KeywordMetric] = {}
    for part in _chunks(ids):
        newest = (
            select(KeywordMetric.keyword_id, func.max(KeywordMetric.measured_at).label("m"))
            .where(KeywordMetric.keyword_id.in_(part), KeywordMetric.market == market, KeywordMetric.language == language)
            .group_by(KeywordMetric.keyword_id)
            .subquery()
        )
        rows = db.scalars(
            select(KeywordMetric).join(newest, (KeywordMetric.keyword_id == newest.c.keyword_id) & (KeywordMetric.measured_at == newest.c.m))
            .where(KeywordMetric.market == market, KeywordMetric.language == language)
        )
        for row in rows:
            if row.keyword_id not in out or row.id > out[row.keyword_id].id:
                out[row.keyword_id] = row
    return out


def add_metrics(
    db: Session, terms: dict[str, KeywordTerm], records: list[MetricRecord], *, provider: str, source: str, market: str, language: str, ttl_days: float,
) -> int:
    """Her kayıt için YENİ ölçüm satırı ekler (eskisini ezmez). Sağlayıcının hiç döndürmediği kelimeler için boş ölçüm de yazılır: TTL boyunca yeniden sorulmaz."""
    now = dt.datetime.utcnow()
    by_term = {r.term: r for r in records}
    for part in _chunks([kw.id for kw in terms.values()]):  # eski "güncel" satırlar kapanır; liste ekranı gruplamadan güncel ölçümü bulur
        db.execute(
            update(KeywordMetric).where(
                KeywordMetric.keyword_id.in_(part), KeywordMetric.market == market, KeywordMetric.language == language, KeywordMetric.is_latest.is_(True),
            ).values(is_latest=False)
        )
    rows = []
    for term, kw in terms.items():
        rec = by_term.get(term) or MetricRecord(term=term)
        rows.append(KeywordMetric(
            keyword_id=kw.id, provider=provider, source=source, market=market, language=language, search_volume=rec.search_volume, cpc=rec.cpc,
            competition=rec.competition, difficulty=rec.difficulty, intent=rec.intent,
            monthly_json=json.dumps(rec.monthly) if rec.monthly else None, measured_at=now, expires_at=policy.expires_at(now, ttl_days),
        ))
    db.add_all(rows)
    return len(rows)


def link_suggestions(db: Session, seed_id: int, ordered: list[KeywordTerm], relation: str = "suggestion") -> None:
    """Tohum -> öneri (ya da soru) ilişkileri; varsa sırası güncellenir."""
    now = dt.datetime.utcnow()
    existing = {l.keyword_id: l for l in db.scalars(select(KeywordLink).where(KeywordLink.seed_id == seed_id, KeywordLink.relation == relation))}
    keep = {kw.id for kw in ordered if kw.id != seed_id}
    for stale_id, stale_link in existing.items():
        if stale_id not in keep:
            db.delete(stale_link)  # yeni listede yok: eski listenin kalıntısı olarak kalmasın
    for rank, kw in enumerate(ordered):
        if kw.id == seed_id:
            continue
        link = existing.get(kw.id)
        if link:
            link.rank, link.observed_at = rank, now
        else:
            db.add(KeywordLink(seed_id=seed_id, keyword_id=kw.id, relation=relation, rank=rank, observed_at=now))


def latest_trends(db: Session, ids: list[int], market: str, language: str) -> dict[int, KeywordTrend]:
    """Her kelimenin bu pazar/dildeki EN YENİ trend ölçümü."""
    out: dict[int, KeywordTrend] = {}
    for part in _chunks(ids):
        newest = (
            select(KeywordTrend.keyword_id, func.max(KeywordTrend.measured_at).label("m"))
            .where(KeywordTrend.keyword_id.in_(part), KeywordTrend.market == market, KeywordTrend.language == language)
            .group_by(KeywordTrend.keyword_id)
            .subquery()
        )
        rows = db.scalars(
            select(KeywordTrend).join(newest, (KeywordTrend.keyword_id == newest.c.keyword_id) & (KeywordTrend.measured_at == newest.c.m))
            .where(KeywordTrend.market == market, KeywordTrend.language == language)
        )
        for row in rows:
            if row.keyword_id not in out or row.id > out[row.keyword_id].id:
                out[row.keyword_id] = row
    return out


def add_trends(
    db: Session, terms: dict[str, KeywordTerm], records: list[TrendRecord], *, provider: str, market: str, language: str, ttl_days: float,
) -> int:
    """Her kelime için YENİ trend satırı ekler; sağlayıcının döndürmediği kelime için boş ölçüm de yazılır (TTL boyunca yeniden sorulmaz)."""
    now = dt.datetime.utcnow()
    by_term = {r.term: r for r in records}
    rows = []
    for term, kw in terms.items():
        rec = by_term.get(term) or TrendRecord(term=term)
        yoy = None
        if rec.recent is not None and rec.previous is not None and rec.previous >= MIN_TREND_INTEREST:
            yoy = round((rec.recent - rec.previous) / rec.previous * 100)
        rows.append(KeywordTrend(
            keyword_id=kw.id, provider=provider, market=market, language=language, recent=rec.recent, previous=rec.previous, yoy_pct=yoy,
            measured_at=now, expires_at=policy.expires_at(now, ttl_days),
        ))
    db.add_all(rows)
    return len(rows)


def latest_season(db: Session, keyword_id: int, market: str, language: str) -> KeywordSeason | None:
    return db.scalars(
        select(KeywordSeason).where(KeywordSeason.keyword_id == keyword_id, KeywordSeason.market == market, KeywordSeason.language == language)
        .order_by(KeywordSeason.measured_at.desc(), KeywordSeason.id.desc()).limit(1)
    ).first()


def add_season(db: Session, kw: KeywordTerm, rec: SeasonRecord, *, provider: str, market: str, language: str, ttl_days: float) -> KeywordSeason:
    """Yeni mevsimsellik satırı; profil çıkmadıysa boş satır yazılır (TTL boyunca yeniden sorulmaz)."""
    now = dt.datetime.utcnow()
    row = KeywordSeason(
        keyword_id=kw.id, provider=provider, market=market, language=language, monthly_json=json.dumps(rec.monthly) if rec.monthly else None, years=rec.years,
        measured_at=now, expires_at=policy.expires_at(now, ttl_days),
    )
    db.add(row)
    return row

"""DB tabanlı iş kuyruğu. Kurallar: aynı anahtarlı AKTİF iş tekrar açılmaz (idempotency/single-flight); iş alma `FOR UPDATE SKIP LOCKED` ile
yapılır (birden çok worker güvenli); yalnızca geçici hata yeniden denenir (üstel bekleme, en fazla `max_attempts`), sonra `dead`."""
import datetime as dt
import json

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.research import budget
from app.research.models import ResearchJob

STUCK_AFTER = dt.timedelta(minutes=15)  # çalışıyor görünüp bu kadar süredir kilitli iş çöken bir worker'ın işidir
BACKOFF_SECONDS = 60
ACTIVE = ("queued", "running")


def params(job: ResearchJob) -> dict:
    return json.loads(job.params_json or "{}")


def active_by_key(db: Session, key: str) -> ResearchJob | None:
    return db.scalar(select(ResearchJob).where(ResearchJob.idem_key == key, ResearchJob.status.in_(ACTIVE)))


def enqueue(
    db: Session, *, kind: str, provider: str, market: str, language: str, key: str, payload: dict, shop_id: int | None = None, priority: int = 0,
) -> ResearchJob:
    """Aynı anahtarlı aktif iş varsa onu döner (yeni iş açılmaz, ücret çıkmaz). Bütçe/kota aşıldıysa `QueueRefused` fırlatır."""
    existing = active_by_key(db, key)
    if existing:
        return existing
    budget.check_enqueue(db, shop_id, kind)
    job = ResearchJob(
        kind=kind, provider=provider, market=market, language=language, idem_key=key[:200], params_json=json.dumps(payload),
        shop_id=shop_id, priority=priority,
    )
    try:
        with db.begin_nested():
            db.add(job)
        return job
    except IntegrityError:  # aynı anda başka bir istek aynı işi açtı
        return active_by_key(db, key) or job


def recover_stuck(db: Session) -> int:
    cutoff = dt.datetime.utcnow() - STUCK_AFTER
    rows = db.scalars(select(ResearchJob).where(ResearchJob.status == "running", ResearchJob.locked_at < cutoff)).all()
    for job in rows:
        job.status, job.locked_at, job.error = "queued", None, "Worker yanıt vermedi; yeniden kuyruğa alındı"
    return len(rows)


def claim(db: Session, *, kind: str | None = None, same_as: ResearchJob | None = None, limit: int = 1) -> list[ResearchJob]:
    """Sıradaki işleri kilitleyip `running` yapar. `same_as` verilirse aynı tür/pazar/dildeki işler (toplu birleştirme için)."""
    now = dt.datetime.utcnow()
    q = select(ResearchJob).where(ResearchJob.status == "queued", ResearchJob.run_after <= now)
    if same_as is not None:
        q = q.where(ResearchJob.kind == same_as.kind, ResearchJob.market == same_as.market, ResearchJob.language == same_as.language,
                    ResearchJob.provider == same_as.provider)
    elif kind:
        q = q.where(ResearchJob.kind == kind)
    rows = db.scalars(q.order_by(ResearchJob.priority.desc(), ResearchJob.id).limit(limit).with_for_update(skip_locked=True)).all()
    for job in rows:
        job.status, job.locked_at, job.attempts = "running", now, job.attempts + 1
    db.flush()
    return list(rows)


def finish(job: ResearchJob, cost_usd: float = 0.0) -> None:
    job.status, job.finished_at, job.locked_at, job.error = "done", dt.datetime.utcnow(), None, ""
    job.cost_usd = float(job.cost_usd or 0) + cost_usd


def defer(job: ResearchJob, reason: str, delay: dt.timedelta) -> None:
    """Hata sayılmayan erteleme (ör. bütçe): deneme hakkı harcanmaz."""
    job.status, job.locked_at, job.error = "queued", None, reason
    job.attempts = max(0, job.attempts - 1)
    job.run_after = dt.datetime.utcnow() + delay


def fail(job: ResearchJob, error: str, transient: bool) -> None:
    job.error, job.locked_at = error[:500], None
    if transient and job.attempts < job.max_attempts:
        job.status = "queued"
        job.run_after = dt.datetime.utcnow() + dt.timedelta(seconds=BACKOFF_SECONDS * 2 ** (job.attempts - 1))
    else:
        job.status = "dead" if transient else "failed"
        job.finished_at = dt.datetime.utcnow()


def cancel(job: ResearchJob) -> bool:
    if job.status != "queued":
        return False
    job.status, job.finished_at = "cancelled", dt.datetime.utcnow()
    return True


def retry(db: Session, job: ResearchJob) -> bool:
    """Bitmiş (failed/dead/cancelled) işi yeniden kuyruğa alır; aynı anahtarlı aktif iş varsa alınmaz."""
    if job.status in ACTIVE or job.status == "done" or active_by_key(db, job.idem_key):
        return False
    job.status, job.attempts, job.run_after, job.error, job.finished_at = "queued", 0, dt.datetime.utcnow(), "", None
    return True

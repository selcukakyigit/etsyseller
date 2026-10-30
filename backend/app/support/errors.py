"""Otomatik hata yakalama: tarayıcıdan ve sunucudan gelen beklenmeyen hatalar parmak iziyle tek satırda toplanır; kullanıcı
talep açmasa da yönetici görür. Metinler kısaltılır, 90 günden eski kayıtlar silinir."""
import datetime as dt
import logging

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.db import SessionLocal
from app.support.fingerprint import fingerprint
from app.support import alerts
from app.support.models import ErrorGroup, ErrorGroupUser, Ticket

log = logging.getLogger("app.support.errors")
RETENTION = dt.timedelta(days=90)
# Gürültü: ağ kopması, tarayıcı eklentileri ve zararsız tarayıcı uyarıları kayda geçmez.
IGNORED_FRAGMENTS = ("failed to fetch", "networkerror", "load failed", "resizeobserver loop", "script error", "chunkload", "aborterror")


def is_noise(message: str) -> bool:
    low = message.lower()
    return any(f in low for f in IGNORED_FRAGMENTS)


def record(db: Session, source: str, message: str, detail: str = "", url: str = "", user_id: int | None = None) -> None:
    """Hata grubunu açar ya da sayacını artırır. Çözülmüş bir hata yeniden görülürse tekrar açılır."""
    message = message.strip()[:400]
    if not message or is_noise(message):
        return
    fp = fingerprint(message)
    now = dt.datetime.utcnow()
    group = db.scalar(select(ErrorGroup).where(ErrorGroup.fingerprint == fp))
    fresh = group is None or group.status == "resolved"  # yeni ya da çözülmüşken geri gelen hata: ekibe haber verilir
    if group is None:
        group = ErrorGroup(fingerprint=fp, source=source, message=message, detail=detail[:2000], url=url[:300], last_user_id=user_id, first_seen=now, last_seen=now)
        db.add(group)
        db.flush()
    else:
        group.count += 1
        group.last_seen = now
        group.url = url[:300] or group.url
        group.last_user_id = user_id or group.last_user_id
        if group.status == "resolved":
            group.status = "open"
    if user_id and db.get(ErrorGroupUser, (group.id, user_id)) is None:
        db.add(ErrorGroupUser(group_id=group.id, user_id=user_id, first_seen=now))
    try:
        db.commit()
    except IntegrityError:  # aynı kullanıcı iki istekte aynı anda ekledi: sayaç artışı kaybolmasın diye yeniden dene
        db.rollback()
        return record(db, source, message, detail, url, user_id)
    if fresh:
        alerts.notify(message, source, url)


def record_server_error(path: str, exc: Exception, trace: str) -> None:
    """Yakalanmamış sunucu hatası (500). Kendi oturumunu açar; kayıt başarısız olsa bile yanıtı bozmaz."""
    db = SessionLocal()
    try:
        record(db, "server", f"{type(exc).__name__}: {exc}", trace[-1800:], path)
    except Exception:
        log.exception("Sunucu hatası kaydedilemedi")
        db.rollback()
    finally:
        db.close()


def list_groups(db: Session, status: str) -> list[dict]:
    """`status`: open | all. Her satıra, aynı hatayı bildiren talep sayısı eklenir."""
    stmt = select(ErrorGroup)
    if status == "open":
        stmt = stmt.where(ErrorGroup.status == "open")
    rows = db.scalars(stmt.order_by(ErrorGroup.last_seen.desc()).limit(200)).all()
    tickets = dict(db.execute(select(Ticket.fingerprint, func.count(Ticket.id)).where(Ticket.fingerprint.in_([r.fingerprint for r in rows])).group_by(Ticket.fingerprint)).all()) if rows else {}
    affected = dict(db.execute(select(ErrorGroupUser.group_id, func.count(ErrorGroupUser.user_id)).where(ErrorGroupUser.group_id.in_([r.id for r in rows])).group_by(ErrorGroupUser.group_id)).all()) if rows else {}
    emails = dict(db.execute(select(User.id, User.email).where(User.id.in_([r.last_user_id for r in rows if r.last_user_id]))).all()) if rows else {}
    return [
        {
            "affected_users": int(affected.get(r.id, 0)), "last_user_id": r.last_user_id, "last_user_email": emails.get(r.last_user_id),
            "id": r.id, "source": r.source, "message": r.message, "detail": r.detail, "url": r.url, "status": r.status, "count": r.count,
            "tickets": int(tickets.get(r.fingerprint, 0)), "first_seen": r.first_seen.isoformat() + "Z", "last_seen": r.last_seen.isoformat() + "Z",
        }
        for r in rows
    ]


def set_status(db: Session, group_id: int, status: str) -> bool:
    group = db.get(ErrorGroup, group_id)
    if group is None:
        return False
    group.status = status
    db.commit()
    return True


def open_count(db: Session) -> int:
    return int(db.scalar(select(func.count(ErrorGroup.id)).where(ErrorGroup.status == "open")) or 0)


def purge_expired(db: Session) -> int:
    rows = db.scalars(select(ErrorGroup).where(ErrorGroup.last_seen < dt.datetime.utcnow() - RETENTION).limit(1000)).all()
    for r in rows:
        db.delete(r)
    db.commit()
    return len(rows)

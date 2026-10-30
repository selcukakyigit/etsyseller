"""Yöneticinin panelden yaptığı değişikliklerin kaydı. Kayıt yazılamazsa asıl işlem geri alınmaz (yalnızca loglanır)."""
import datetime as dt
import logging

from sqlalchemy import func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.admin.deps import escape_like
from app.admin.models import AdminAuditLog
from app.admin.schemas import AuditOut, AuditPageOut
from app.auth.models import User
from app.core.dates import iso

log = logging.getLogger(__name__)
MAX_PAGE = 100
MAX_EXPORT = 50000


def record(db: Session, admin: User, action: str, target: str = "", detail: str = "") -> None:
    try:
        db.add(AdminAuditLog(user_id=admin.id, email=admin.email, action=action[:60], target=target[:120], detail=detail[:2000]))
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        log.exception("Yönetici işlemi kaydedilemedi: %s %s", action, target)


def _filtered(q: str, action: str, admin: str, date_from: dt.date | None, date_to: dt.date | None) -> list:
    where = []
    if action:
        where.append(AdminAuditLog.action == action)
    if admin:
        where.append(AdminAuditLog.email == admin)
    if date_from:
        where.append(AdminAuditLog.created_at >= dt.datetime.combine(date_from, dt.time.min))
    if date_to:
        where.append(AdminAuditLog.created_at < dt.datetime.combine(date_to + dt.timedelta(days=1), dt.time.min))
    if q.strip():
        pattern = f"%{escape_like(q.strip().lower())}%"
        where.append(or_(*(func.lower(col).like(pattern, escape="\\") for col in (AdminAuditLog.target, AdminAuditLog.detail, AdminAuditLog.email))))
    return where


def _out(r: AdminAuditLog) -> AuditOut:
    return AuditOut(id=r.id, email=r.email, action=r.action, target=r.target, detail=r.detail, created_at=iso(r.created_at))


def search(
    db: Session, q: str = "", action: str = "", admin: str = "", date_from: dt.date | None = None, date_to: dt.date | None = None,
    limit: int = 50, offset: int = 0,
) -> AuditPageOut:
    where = _filtered(q, action, admin, date_from, date_to)
    total = int(db.scalar(select(func.count(AdminAuditLog.id)).where(*where)) or 0)
    rows = db.scalars(
        select(AdminAuditLog).where(*where).order_by(AdminAuditLog.id.desc()).limit(max(1, min(limit, MAX_PAGE))).offset(max(0, offset))
    ).all()
    actions = sorted(db.scalars(select(AdminAuditLog.action).distinct()).all())
    return AuditPageOut(items=[_out(r) for r in rows], total=total, actions=actions)


def export_rows(db: Session, **filters) -> list[AuditOut]:
    where = _filtered(filters.get("q", ""), filters.get("action", ""), filters.get("admin", ""), filters.get("date_from"), filters.get("date_to"))
    rows = db.scalars(select(AdminAuditLog).where(*where).order_by(AdminAuditLog.id.desc()).limit(MAX_EXPORT)).all()
    return [_out(r) for r in rows]

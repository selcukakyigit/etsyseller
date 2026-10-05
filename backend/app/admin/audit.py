"""Yöneticinin panelden yaptığı değişikliklerin kaydı. Kayıt yazılamazsa asıl işlem geri alınmaz (yalnızca loglanır)."""
import logging

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.admin.models import AdminAuditLog
from app.admin.schemas import AuditOut
from app.auth.models import User
from app.core.dates import iso

log = logging.getLogger(__name__)
MAX_ROWS = 100


def record(db: Session, admin: User, action: str, target: str = "", detail: str = "") -> None:
    try:
        db.add(AdminAuditLog(user_id=admin.id, email=admin.email, action=action[:60], target=target[:120], detail=detail[:2000]))
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        log.exception("Yönetici işlemi kaydedilemedi: %s %s", action, target)


def recent(db: Session) -> list[AuditOut]:
    rows = db.scalars(select(AdminAuditLog).order_by(AdminAuditLog.id.desc()).limit(MAX_ROWS)).all()
    return [AuditOut(id=r.id, email=r.email, action=r.action, target=r.target, detail=r.detail, created_at=iso(r.created_at)) for r in rows]

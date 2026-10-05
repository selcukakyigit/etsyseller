"""Hesap erişimi: durum (aktif / askıda / engelli), panelden verilen rol ve son aktif zamanı.

Satırı olmayan kullanıcı aktif ve "user" sayılır. Yöneticiler iki yoldan gelir: ADMIN_EMAILS (sunucu ortamı, panelden
değiştirilemez) ya da panelden verilen `role = "admin"`.

Her istek `check_and_touch` ile geçer (core/deps.py get_current_user). Tablo okunamazsa (göç uygulanmamış) istek
engellenmez: erişim kontrolü yüzünden kimse kilitlenmesin."""
import datetime as dt
import logging

from fastapi import HTTPException
from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.auth.models import User
from app.core.config import settings
from app.core.db import Base

log = logging.getLogger(__name__)

STATUSES = ("active", "suspended", "blocked")
ROLES = ("user", "admin")
# Son aktif zamanı her istekte değil, en fazla bu aralıkla yazılır.
TOUCH_EVERY = dt.timedelta(minutes=5)
# Durumu ne olursa olsun erişilebilen uç noktalar: ön yüz kullanıcının durumunu buradan öğrenip bilgi ekranı gösterir.
STATUS_EXEMPT_PATHS = ("/api/auth/me",)

SUSPENDED_MESSAGE = "Hesabın askıya alındı. Destek için iletişim sayfasından bize yazabilirsin."
BLOCKED_MESSAGE = "Hesabın engellendi."


class UserAccess(Base):
    __tablename__ = "user_access"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(12), default="active", server_default="active")
    role: Mapped[str] = mapped_column(String(12), default="user", server_default="user")
    status_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    status_changed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


def env_admin(user: User) -> bool:
    admins = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    return user.email.lower() in admins


def get(db: Session, user_id: int) -> UserAccess | None:
    try:
        return db.get(UserAccess, user_id)
    except SQLAlchemyError:
        db.rollback()
        log.warning("user_access okunamadı", exc_info=True)
        return None


def ensure(db: Session, user_id: int) -> UserAccess:
    """Satırı döner, yoksa oluşturur (çağıran commit eder)."""
    row = db.get(UserAccess, user_id)
    if row is None:
        row = UserAccess(user_id=user_id, status="active", role="user")
        db.add(row)
        db.flush()
    return row


def is_admin(db: Session, user: User) -> bool:
    if env_admin(user):
        return True
    row = get(db, user.id)
    return row is not None and row.role == "admin"


def status_of(db: Session, user: User) -> str:
    row = get(db, user.id)
    return row.status if row is not None else "active"


def check_and_touch(db: Session, user: User, path: str) -> None:
    """Askıdaki/engelli hesabı reddeder (403), aktifse son aktif zamanını günceller."""
    try:
        row = db.get(UserAccess, user.id)
        if row is not None and row.status != "active" and path not in STATUS_EXEMPT_PATHS:
            raise HTTPException(403, BLOCKED_MESSAGE if row.status == "blocked" else SUSPENDED_MESSAGE)
        now = dt.datetime.utcnow()
        if row is None or row.last_seen_at is None or now - row.last_seen_at > TOUCH_EVERY:
            if row is None:
                row = UserAccess(user_id=user.id, status="active", role="user")
                db.add(row)
            row.last_seen_at = now
            db.commit()
    except SQLAlchemyError:
        db.rollback()
        log.warning("Erişim kontrolü yapılamadı (user=%s); istek engellenmedi", user.id, exc_info=True)

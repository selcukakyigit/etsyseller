import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AdminAuditLog(Base):
    """Yöneticinin panelden yaptığı her değişiklik (kim, ne, neye). Anahtar gibi gizli değerler `detail`e yazılmaz."""

    __tablename__ = "admin_audit_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer)
    email: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(60))
    target: Mapped[str] = mapped_column(String(120), default="", server_default="")
    detail: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)


class AdminUserNote(Base):
    """Yöneticinin bir kullanıcı hakkındaki iç notu (kullanıcı görmez)."""

    __tablename__ = "admin_user_notes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(Integer)
    author_email: Mapped[str] = mapped_column(String(255))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class Announcement(Base):
    """Uygulama içi duyuru bandı. Aktif ve süresi dolmamış olanların hepsi giriş yapmış kullanıcılara gösterilir (alt alta)."""

    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tone: Mapped[str] = mapped_column(String(10), default="info")  # info | warning
    text_tr: Mapped[str] = mapped_column(String(400))
    text_en: Mapped[str] = mapped_column(String(400))
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    ends_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class EmailBroadcast(Base):
    """Tüm kullanıcılara giden hizmet e-postası: taslak, gönderilirken ilerleme ve sonuç. Gönderilmiş kayıt değişmez (geçmiş olarak durur)."""

    __tablename__ = "email_broadcasts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    subject_tr: Mapped[str] = mapped_column(String(150), default="")
    subject_en: Mapped[str] = mapped_column(String(150), default="")
    body_tr: Mapped[str] = mapped_column(Text, default="")
    body_en: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="draft", index=True)  # draft | sending | done | interrupted
    total: Mapped[int] = mapped_column(Integer, default=0)
    sent: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)

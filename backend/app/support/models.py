import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Ticket(Base):
    """Giriş yapmış kullanıcının destek talebi (hata bildirimi, soru, istek). Yazışma `TicketMessage`'larda durur.
    Durum akışı: open (yönetici bekleniyor) → waiting_user (kullanıcı bekleniyor) → resolved; kullanıcı yanıtlayınca yeniden open.
    `user_unread` / `admin_unread`: karşı tarafın okumadığı yeni bir şey var (rozet ve bildirim için)."""

    __tablename__ = "support_tickets"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(20))  # bug | question | feature | billing | other
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    # Talep açılırken tarayıcının otomatik eklediği bağlam (sayfa, tarayıcı, dil, tema, son arayüz hataları) — JSON.
    context_json: Mapped[str] = mapped_column(Text, default="{}")
    user_unread: Mapped[bool] = mapped_column(Boolean, default=False)
    admin_unread: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    # Tamamlanan talep için kullanıcının puanı: 1 (işe yaradı) | -1 (yaramadı).
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Bağlamdaki son arayüz hatasının parmak izi (support/fingerprint.py): aynı hatayı bildirenler gruplanır.
    fingerprint: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)

    messages: Mapped[list["TicketMessage"]] = relationship(back_populates="ticket", cascade="all, delete-orphan", order_by="TicketMessage.id")


class TicketMessage(Base):
    """Talebe yazılan mesaj. `internal`: yalnızca yöneticilerin gördüğü not (kullanıcıya hiçbir yerde dönmez)."""

    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True)
    author_kind: Mapped[str] = mapped_column(String(10))  # user | admin
    body: Mapped[str] = mapped_column(Text)
    internal: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    ticket: Mapped["Ticket"] = relationship(back_populates="messages")
    attachments: Mapped[list["TicketAttachment"]] = relationship(back_populates="message", cascade="all, delete-orphan")


class TicketAttachment(Base):
    """Mesaja eklenen dosya / ekran görüntüsü. İçerik özel bir Supabase Storage kovasında durur; burada yalnızca künyesi vardır."""

    __tablename__ = "support_attachments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("support_messages.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(String(300))

    message: Mapped["TicketMessage"] = relationship(back_populates="attachments")


class CannedReply(Base):
    """Yöneticilerin sık kullandığı hazır yanıt; yanıt kutusundan seçilip metne eklenir."""

    __tablename__ = "support_canned_replies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(80))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class ErrorGroup(Base):
    """Aynı hatanın tekrarları tek satırda toplanır (parmak izine göre). Kaynak: tarayıcı (`client`) ya da sunucu (`server`).
    Metin ve iz kişisel veri içermemeli diye kısaltılır; kullanıcı bilgisi yalnızca son görülen kullanıcı kimliğidir."""

    __tablename__ = "support_error_groups"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    fingerprint: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(10))  # client | server
    message: Mapped[str] = mapped_column(String(400))
    detail: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(10), default="open", index=True)  # open | resolved | ignored
    count: Mapped[int] = mapped_column(Integer, default=1)
    last_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    first_seen: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    last_seen: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)

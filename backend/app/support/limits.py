"""Destek yazışmasının hız sınırları (talep açma, yönetici ekibine mesaj, ek boyutu, bildirim e-postası).
Kullanıcı ekranı ve asistan aracı aynı kontrolleri geçer; sayımlar veritabanından yapılır (birden çok sunucu kopyasında da doğru)."""
import datetime as dt

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.i18n import tr
from app.core.limits import SlidingWindow
from app.support.models import Ticket, TicketAttachment, TicketMessage

MAX_TICKETS_PER_HOUR = 10
MAX_TICKETS_PER_DAY = 30
MAX_MESSAGES_PER_TICKET_HOUR = 40
MAX_MESSAGES_PER_USER_HOUR = 60  # bütün taleplerinde toplam: bir kullanıcı yönetici kuyruğunu dolduramasın
MAX_ATTACHMENT_BYTES_PER_HOUR = 60 * 1024 * 1024
MIN_GAP_SECONDS = 2  # art arda iki gönderim (çift tıklama, takılan istemci) arasında en az bu kadar

# Yöneticiye giden "yeni yanıt" e-postası: aynı talep için 10 dakikada en fazla bir (yeni talep e-postası hep gider).
_reply_mail = SlidingWindow(limit=1, window=600)


def _ago(**kw) -> dt.datetime:
    return dt.datetime.utcnow() - dt.timedelta(**kw)


def _too_many(message_tr: str, message_en: str) -> HTTPException:
    return HTTPException(429, tr(message_tr, message_en))


def check_new_ticket(db: Session, user: User) -> None:
    def made(since: dt.datetime) -> int:
        return int(db.scalar(select(func.count(Ticket.id)).where(Ticket.user_id == user.id, Ticket.created_at >= since)) or 0)

    if made(_ago(hours=1)) >= MAX_TICKETS_PER_HOUR or made(_ago(days=1)) >= MAX_TICKETS_PER_DAY:
        raise _too_many("Çok fazla talep açtın. Biraz sonra tekrar dene.", "Too many requests. Please try again later.")


def check_user_message(db: Session, ticket: Ticket, new_bytes: int = 0) -> None:
    """Kullanıcının mevcut talebe yazdığı mesaj: talep başına, toplam, tekrar aralığı ve ek boyutu sınırı."""
    mine = (TicketMessage.author_kind == "user", Ticket.user_id == ticket.user_id)
    base = select(func.count(TicketMessage.id)).join(Ticket, Ticket.id == TicketMessage.ticket_id).where(*mine)
    hour = TicketMessage.created_at >= _ago(hours=1)
    if int(db.scalar(base.where(hour, TicketMessage.ticket_id == ticket.id)) or 0) >= MAX_MESSAGES_PER_TICKET_HOUR:
        raise _too_many("Bu talebe çok fazla mesaj gönderdin. Biraz sonra tekrar dene.", "Too many messages on this request. Please try again later.")
    if int(db.scalar(base.where(hour)) or 0) >= MAX_MESSAGES_PER_USER_HOUR:
        raise _too_many("Çok fazla mesaj gönderdin. Biraz sonra tekrar dene.", "Too many messages. Please try again later.")
    if int(db.scalar(base.where(TicketMessage.created_at >= _ago(seconds=MIN_GAP_SECONDS))) or 0) > 0:
        raise _too_many("Çok hızlı gönderiyorsun; bir saniye bekle.", "You are sending too fast; wait a moment.")
    sent = db.scalar(
        select(func.coalesce(func.sum(TicketAttachment.size), 0))
        .join(TicketMessage, TicketMessage.id == TicketAttachment.message_id).join(Ticket, Ticket.id == TicketMessage.ticket_id)
        .where(*mine, hour)
    )
    if int(sent or 0) + new_bytes > MAX_ATTACHMENT_BYTES_PER_HOUR:
        raise _too_many("Bu saat için dosya yükleme sınırına ulaştın. Biraz sonra tekrar dene.", "You reached the file upload limit for this hour. Please try again later.")


def allow_team_reply_mail(ticket_id: int) -> bool:
    """Ekibe "kullanıcı yanıtladı" e-postası gitsin mi? (Yanıt yine kaydedilir ve panelde okunmamış görünür.)"""
    return _reply_mail.hit(ticket_id)

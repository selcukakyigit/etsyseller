"""İletişim formundan gelen mesajlar: listeleme, "ilgilenildi" işareti ve ek indirme adresi."""
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.admin.deps import AdminError
from app.core.dates import iso
from app.admin.schemas import AttachmentOut, AttachmentUrlOut, MessageOut
from app.contact.models import ContactAttachment, ContactMessage
from app.contact.router import BUCKET
from app.core import storage
from app.core.config import settings
from app.emails.renderer import render
from app.emails.sender import email_configured, send_email

MAX_MESSAGES = 200


class NotFound(Exception):
    pass


def _out(row: ContactMessage) -> MessageOut:
    return MessageOut(
        id=row.id,
        name=row.name,
        email=row.email,
        topic=row.topic,
        message=row.message,
        lang=row.lang,
        handled=row.handled,
        created_at=iso(row.created_at),
        attachments=[AttachmentOut(id=a.id, filename=a.filename, size=a.size) for a in row.attachments],
    )


def list_messages(db: Session, only_open: bool) -> list[MessageOut]:
    stmt = select(ContactMessage).options(selectinload(ContactMessage.attachments)).order_by(ContactMessage.id.desc()).limit(MAX_MESSAGES)
    if only_open:
        stmt = stmt.where(ContactMessage.handled.is_(False))
    return [_out(r) for r in db.scalars(stmt).all()]


def set_handled(db: Session, message_id: int, handled: bool) -> MessageOut:
    row = db.get(ContactMessage, message_id)
    if row is None:
        raise NotFound
    row.handled = handled
    db.commit()
    return _out(row)


def reply(db: Session, message_id: int, body: str) -> MessageOut:
    """Gönderene e-posta ile yanıt verir (yanıt adresi ekibin iletişim kutusudur, gönderen yanıtlayınca ekibe döner) ve mesajı "ilgilenildi" yapar.
    Yanıt metni saklanmaz; yönetici işlem kaydında yalnızca kimin kime yanıtladığı durur."""
    row = db.get(ContactMessage, message_id)
    if row is None:
        raise NotFound
    if not email_configured():
        raise AdminError(503, "E-posta gönderimi yapılandırılmamış.")
    tr = row.lang == "tr"
    html, text = render(
        "admin_reply.html", title="Ulagg", preheader=body[:90],
        greeting=f"Merhaba {row.name}," if tr else f"Hi {row.name},", body=body.strip(),
        quoted_label="Mesajınız:" if tr else "Your message:", original=row.message[:1500],
    )
    reply_to = next((a.strip() for a in settings.contact_to.split(",") if a.strip()), None)
    if not send_email([row.email], "Ulagg: mesajınıza yanıt" if tr else "Ulagg: reply to your message", html, text, reply_to=reply_to):
        raise AdminError(502, "Yanıt gönderilemedi.")
    row.handled = True
    db.commit()
    return _out(row)


def attachment_url(db: Session, attachment_id: int) -> AttachmentUrlOut:
    """5 dakika geçerli, imzalı indirme adresi (dosya özel kovadadır)."""
    att = db.get(ContactAttachment, attachment_id)
    if att is None:
        raise NotFound
    return AttachmentUrlOut(url=storage.signed_url(BUCKET, att.storage_path), filename=att.filename)

"""Destek talepleri: oluşturma, yazışma, durum akışı, bildirim e-postaları ve saklama temizliği.
Kullanıcı ve yönetici uçları aynı servisi kullanır; hangi tarafın neyi göreceği `*_out` biçimlendiricilerinde ayrılır."""
import datetime as dt
import json
import logging
import secrets

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.auth.models import User
from app.core import storage
from app.core.config import settings
from app.core.dates import iso
from app.core.i18n import tr
from app.core.attachments import MAX_FILE_BYTES
from app.emails.renderer import render
from app.emails.sender import send_email
from app.support import limits, taxonomy
from app.support.fingerprint import fingerprint
from app.support.models import ErrorGroup, Ticket, TicketAttachment, TicketEvent, TicketLabel, TicketMessage

log = logging.getLogger("app.support")

BUCKET = "support-attachments"
MAX_FILES = 5
RETENTION = dt.timedelta(days=365)  # çözülen talepler (ve ekleri) son hareketten 12 ay sonra silinir
CONTEXT_TEXT_KEYS = ("url", "referrer", "user_agent", "viewport", "theme", "lang", "shop", "app_version")
MAX_ERRORS = 5
MAX_CHAT_LINES = 12  # asistandan açılan talepte sohbetin son mesajları (bağlama yazılır; yönetici görür)
_THREAD = selectinload(Ticket.messages).selectinload(TicketMessage.attachments)


# ---- bağlam ve oluşturma


def clean_context(raw: str | dict) -> dict:
    """Bağlamı (tarayıcıdan JSON metni, asistandan sözlük) güvenli ve küçük bir biçime indirir (bilinmeyen alanlar atılır)."""
    try:
        data = raw if isinstance(raw, dict) else json.loads(raw or "{}")
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict = {k: str(data[k])[:300] for k in CONTEXT_TEXT_KEYS if data.get(k) not in (None, "")}
    errors = data.get("errors")
    if isinstance(errors, list):
        out["errors"] = [str(e)[:400] for e in errors[-MAX_ERRORS:]]
    chat = data.get("chat")
    if isinstance(chat, list) and chat:
        out["chat"] = [str(line)[:700] for line in chat[-MAX_CHAT_LINES:]]
    return out


def log_event(db: Session, ticket: Ticket, kind: str, detail: str = "", actor: User | None = None) -> None:
    """Talebin iş kaydına satır ekler (commit çağıranın)."""
    db.add(TicketEvent(ticket_id=ticket.id, actor_id=actor.id if actor else None, kind=kind, detail=detail[:300]))


def _attach(db: Session, ticket_id: int, msg: TicketMessage, prepared: list[tuple[str, str, bytes]]) -> None:
    """Dosyaları depoya yükler; hata olursa yüklenenleri geri alır ve 503 verir (ekran görüntüsü sessizce kaybolmasın)."""
    uploaded: list[str] = []
    try:
        if prepared:
            storage.ensure_bucket(BUCKET, MAX_FILE_BYTES)
        for fname, ctype, data in prepared:
            path = f"{ticket_id}/{secrets.token_hex(8)}-{fname}"
            storage.upload(BUCKET, path, data, ctype)
            uploaded.append(path)
            msg.attachments.append(TicketAttachment(filename=fname, content_type=ctype, size=len(data), storage_path=path))
    except Exception as exc:
        log.exception("Destek eki yüklenemedi (talep #%s)", ticket_id)
        db.rollback()
        _delete_paths(uploaded)
        raise HTTPException(503, tr("Dosya yüklenemedi. Biraz sonra tekrar dene.", "The file could not be uploaded. Please try again shortly.")) from exc


def create_ticket(
    db: Session, user: User, subject: str, category: str, body: str, context: dict, prepared: list[tuple[str, str, bytes]], source: str = "web",
) -> Ticket:
    """`source`: talebin nereden açıldığı (taxonomy.SOURCES). Ekran ve asistan aynı fonksiyonu, aynı hız sınırlarıyla kullanır."""
    limits.check_new_ticket(db, user)
    ticket = Ticket(
        user_id=user.id, subject=subject.strip()[:160], category=category if category in taxonomy.CATEGORIES else "other",
        source=source if source in taxonomy.SOURCES else "web", context_json=json.dumps(context, ensure_ascii=False),
        fingerprint=fingerprint(context["errors"][-1]) if context.get("errors") else None,
    )
    db.add(ticket)
    db.flush()
    log_event(db, ticket, "created", ticket.source, user)
    msg = TicketMessage(ticket_id=ticket.id, author_kind="user", body=body.strip())
    db.add(msg)
    db.flush()
    _attach(db, ticket.id, msg, prepared)
    db.commit()
    return ticket


def add_message(db: Session, ticket: Ticket, kind: str, body: str, prepared: list[tuple[str, str, bytes]], internal: bool = False) -> TicketMessage:
    """`kind`: user | admin. Kullanıcı yanıtı talebi yeniden açar; yöneticinin (iç not olmayan) yanıtı kullanıcıya bildirim düşürür."""
    if kind == "user":
        limits.check_user_message(db, ticket, sum(len(data) for _, _, data in prepared))
    msg = TicketMessage(ticket_id=ticket.id, author_kind=kind, body=body.strip(), internal=internal)
    db.add(msg)
    db.flush()
    _attach(db, ticket.id, msg, prepared)
    if kind == "user":
        ticket.status, ticket.resolved_at, ticket.admin_unread = "open", None, True
    elif not internal:
        if ticket.status != "resolved":
            ticket.status = "waiting_user"
        ticket.user_unread = True
        ticket.first_response_at = ticket.first_response_at or dt.datetime.utcnow()
    if not internal:
        ticket.updated_at = dt.datetime.utcnow()
    db.commit()
    return msg


def set_status(db: Session, ticket: Ticket, status: str, actor: User | None = None) -> None:
    if status not in taxonomy.STATUSES:
        raise HTTPException(422, tr("Geçersiz durum", "Invalid status"))
    if status == ticket.status:
        return
    log_event(db, ticket, "status", status, actor)
    ticket.status = status
    ticket.updated_at = dt.datetime.utcnow()
    ticket.resolved_at = dt.datetime.utcnow() if status == "resolved" else None
    if status == "resolved":
        ticket.user_unread = True
    db.commit()


def rate(db: Session, ticket: Ticket, rating: int) -> None:
    """Kullanıcı tamamlanan talebi puanlar: 1 (işe yaradı) | -1 (yaramadı)."""
    if ticket.status != "resolved" or rating not in (1, -1):
        raise HTTPException(422, tr("Yalnızca tamamlanan talep puanlanabilir", "Only a completed request can be rated"))
    ticket.rating = rating
    log_event(db, ticket, "rating", str(rating), None)
    db.commit()


def update_ticket(db: Session, ticket: Ticket, actor: User, changes: dict, staff_ids: set[int]) -> bool:
    """Yönetici değişikliği: `changes` yalnızca gelen alanları taşır (status, assignee_id, priority, labels); her biri iş kaydına yazılır.
    Talep bu çağrıyla tamamlandıysa True döner (çağıran kullanıcıya bildirim gönderir). `staff_ids`: atanabilecek yöneticiler."""
    was = ticket.status
    if "status" in changes:
        set_status(db, ticket, changes["status"], actor)
    if "assignee_id" in changes and changes["assignee_id"] != ticket.assignee_id:
        target = changes["assignee_id"]
        if target is not None and target not in staff_ids:
            raise HTTPException(422, tr("Yalnızca yöneticilere atanabilir", "Can only be assigned to an admin"))
        who = db.get(User, target) if target is not None else None
        log_event(db, ticket, "assignee", (who.name or who.email) if who else "", actor)
        ticket.assignee_id = target
    if "priority" in changes and changes["priority"] != ticket.priority:
        if changes["priority"] not in taxonomy.PRIORITIES:
            raise HTTPException(422, tr("Geçersiz öncelik", "Invalid priority"))
        log_event(db, ticket, "priority", changes["priority"], actor)
        ticket.priority = changes["priority"]
    if "labels" in changes:
        wanted = taxonomy.clean_labels(changes["labels"])
        have = {l.label for l in ticket.labels}
        if set(wanted) != have:
            for row in [l for l in ticket.labels if l.label not in wanted]:
                ticket.labels.remove(row)
            ticket.labels.extend(TicketLabel(label=k) for k in wanted if k not in have)
            log_event(db, ticket, "labels", ",".join(wanted), actor)
    db.commit()
    return was != "resolved" and ticket.status == "resolved"


def similar(db: Session, ticket: Ticket, limit: int = 20) -> list[Ticket]:
    """Aynı hata parmak izini taşıyan diğer talepler."""
    if not ticket.fingerprint:
        return []
    return list(db.scalars(select(Ticket).where(Ticket.fingerprint == ticket.fingerprint, Ticket.id != ticket.id).order_by(Ticket.updated_at.desc()).limit(limit)))


def resolve_group(db: Session, ticket: Ticket) -> list[Ticket]:
    """Aynı hatayı bildiren (bu dahil) tüm açık talepleri tamamlar; tamamlananları döner (kullanıcılara bildirim için)."""
    rows = [ticket]
    if ticket.fingerprint:
        rows = list(db.scalars(select(Ticket).where(Ticket.fingerprint == ticket.fingerprint, Ticket.status != "resolved")))
    done = [t for t in rows if t.status != "resolved"]
    for t in done:
        set_status(db, t, "resolved")
    return done


def error_count(db: Session, ticket: Ticket) -> int:
    """Aynı hatanın otomatik yakalanma sayısı (talep açmayanlar dahil)."""
    if not ticket.fingerprint:
        return 0
    return int(db.scalar(select(func.coalesce(func.sum(ErrorGroup.count), 0)).where(ErrorGroup.fingerprint == ticket.fingerprint)) or 0)


# ---- sorgular


def user_ticket(db: Session, user: User, ticket_id: int) -> Ticket:
    """Yalnızca kendi talebi; başkasının talebi 404 (varlığı sızdırılmaz)."""
    ticket = db.scalar(select(Ticket).where(Ticket.id == ticket_id, Ticket.user_id == user.id).options(_THREAD))
    if ticket is None:
        raise HTTPException(404, tr("Talep bulunamadı", "Request not found"))
    return ticket


def admin_ticket(db: Session, ticket_id: int) -> Ticket:
    ticket = db.scalar(select(Ticket).where(Ticket.id == ticket_id).options(_THREAD))
    if ticket is None:
        raise HTTPException(404, tr("Talep bulunamadı", "Request not found"))
    return ticket


def list_for_user(db: Session, user: User) -> list[dict]:
    rows = db.scalars(select(Ticket).where(Ticket.user_id == user.id).order_by(Ticket.updated_at.desc()).limit(100)).all()
    return [summary_out(t) for t in rows]


def unread_count(db: Session, user: User) -> int:
    return int(db.scalar(select(func.count(Ticket.id)).where(Ticket.user_id == user.id, Ticket.user_unread.is_(True))) or 0)


def open_count(db: Session) -> int:
    """Yanıt bekleyen (yönetici sırası) talepler: Genel bakış kartı için."""
    return int(db.scalar(select(func.count(Ticket.id)).where(Ticket.status == "open")) or 0)


def attachment(db: Session, attachment_id: int) -> TicketAttachment:
    att = db.get(TicketAttachment, attachment_id)
    if att is None:
        raise HTTPException(404, tr("Ek bulunamadı", "Attachment not found"))
    return att


def user_attachment(db: Session, user: User, attachment_id: int) -> TicketAttachment:
    """Kullanıcı yalnızca kendi talebinin, iç not olmayan mesajlarındaki eklere erişir; aksi halde 404."""
    att = attachment(db, attachment_id)
    if att.message.ticket.user_id != user.id or att.message.internal:
        raise HTTPException(404, tr("Ek bulunamadı", "Attachment not found"))
    return att


def attachment_url(att: TicketAttachment) -> dict:
    """5 dakika geçerli, imzalı indirme adresi (dosya özel kovadadır)."""
    return {"url": storage.signed_url(BUCKET, att.storage_path), "filename": att.filename}


# ---- biçimlendirme


def summary_out(t: Ticket) -> dict:
    return {
        "id": t.id, "subject": t.subject, "category": t.category, "status": t.status,
        "user_unread": t.user_unread, "rating": t.rating, "created_at": iso(t.created_at), "updated_at": iso(t.updated_at),
    }


def message_out(m: TicketMessage) -> dict:
    return {
        "id": m.id, "author": m.author_kind, "body": m.body, "internal": m.internal, "created_at": iso(m.created_at),
        "attachments": [{"id": a.id, "filename": a.filename, "size": a.size, "content_type": a.content_type} for a in m.attachments],
    }


def user_detail(t: Ticket) -> dict:
    return {**summary_out(t), "messages": [message_out(m) for m in t.messages if not m.internal]}


# ---- e-posta (arka planda; ORM nesnesi değil düz değerler taşınır, oturum kapandıktan sonra da çalışsın)


def _link(path: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}{path}"


def notify_team(ticket_id: int, subject: str, user_email: str, body: str, kind: str) -> None:
    """Ekibe yeni talep / kullanıcı yanıtı bildirimi (CONTACT_TO adreslerine). Yanıt e-postası talep başına 10 dakikada bir gider."""
    if kind == "reply" and not limits.allow_team_reply_mail(ticket_id):
        return
    to = [a.strip() for a in settings.contact_to.split(",") if a.strip()]
    if not to:
        return
    title = f"[Ulagg destek #{ticket_id}] {subject}"
    markup, text = render(
        "order_notification.html", title=title, preheader=body[:90],
        heading="New support request" if kind == "new" else "New reply on a support request",
        rows=[("From", user_email), ("Subject", subject), ("Message", body[:600])],
        url=_link(f"/admin/tickets?id={ticket_id}"), button_label="Open in admin", footer="Ulagg support",
    )
    send_email(to, title, markup, text, reply_to=user_email)


def notify_user(ticket_id: int, subject: str, user_email: str, lang: str, kind: str, body: str = "") -> None:
    """Kullanıcıya: yöneticinin yanıtı ("reply") ya da talebin tamamlandığı ("resolved") bildirimi, kendi dilinde."""
    en = lang == "en"
    if kind == "resolved":
        heading = f"Your request #{ticket_id} is done" if en else f"#{ticket_id} numaralı isteğin tamamlandı"
        rows = [("Subject" if en else "Konu", subject)]
    else:
        heading = f"New reply to your request #{ticket_id}" if en else f"#{ticket_id} numaralı isteğine yanıt geldi"
        rows = [("Subject" if en else "Konu", subject), ("Reply" if en else "Yanıt", body[:600])]
    markup, text = render(
        "order_notification.html", title=heading, preheader=subject, heading=heading, rows=rows,
        url=_link(f"/support?id={ticket_id}"), button_label="Open request" if en else "Talebi aç",
        footer="You get this email because you opened a support request in Ulagg." if en else "Bu e-postayı Ulagg'da destek talebi açtığın için alıyorsun.",
    )
    send_email([user_email], heading, markup, text, reply_to=settings.support_reply_to or None)


# ---- saklama


def _delete_paths(paths: list[str]) -> list[str]:
    """Silinemeyen yolları döner (çağıran isterse satırı tutup yeniden dener)."""
    failed = []
    for p in paths:
        try:
            storage.delete(BUCKET, p)
        except Exception:
            log.exception("Destek eki silinemedi: %s", p)
            failed.append(p)
    return failed


def _paths(ticket: Ticket) -> list[str]:
    return [a.storage_path for m in ticket.messages for a in m.attachments]


def delete_user_tickets(db: Session, user_id: int) -> None:
    """Hesap silinirken kullanıcının taleplerinin ekleri depodan kaldırılır (satırlar kullanıcıyla birlikte cascade ile gider)."""
    for ticket in db.scalars(select(Ticket).where(Ticket.user_id == user_id).options(_THREAD)):
        _delete_paths(_paths(ticket))


def purge_expired(db: Session) -> int:
    """Son hareketi 12 aydan eski çözülmüş talepler: önce dosyalar, başarısızsa satır kalır, ertesi gün tekrar denenir."""
    cutoff = dt.datetime.utcnow() - RETENTION
    rows = db.scalars(select(Ticket).where(Ticket.status == "resolved", Ticket.updated_at < cutoff).options(_THREAD).limit(500)).all()
    removed = 0
    for ticket in rows:
        if _delete_paths(_paths(ticket)):
            continue
        db.delete(ticket)
        removed += 1
    db.commit()
    return removed

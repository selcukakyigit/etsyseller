"""Destek talepleri: yönetici uçları. Yetki router seviyesinde (`admin_only`): yönetici olmayana 404."""
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.audit import record as audit_record
from app.admin.deps import admin_only
from app.auth.models import User
from app.core.attachments import read_uploads
from app.core.db import get_db
from app.support import alerts, canned, errors, queue, report, service, taxonomy
from app.support.models import Ticket
from app.support.router import check_size

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(admin_only)])


class TicketPatch(BaseModel):
    """Yalnızca gönderilen alanlar uygulanır."""

    status: Literal["open", "waiting_user", "resolved"] | None = None
    assignee_id: int | None = None
    priority: Literal["low", "normal", "urgent"] | None = None
    labels: list[str] | None = Field(default=None, max_length=len(taxonomy.LABELS))


class BulkIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=100)
    changes: TicketPatch


class CannedIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=4000)


class ErrorStatusIn(BaseModel):
    status: str = Field(pattern="^(open|resolved|ignored)$")


def _notify_done(background: BackgroundTasks, db: Session, ticket: Ticket) -> None:
    owner = db.get(User, ticket.user_id)
    background.add_task(service.notify_user, ticket.id, ticket.subject, owner.email, owner.email_lang, "resolved")


def _apply(db: Session, background: BackgroundTasks, admin: User, ticket: Ticket, patch: TicketPatch) -> None:
    """Tek talebe değişiklik: PATCH ve toplu işlem aynı yolu kullanır (iş kaydı, kullanıcı bildirimi, denetim satırı)."""
    changes = {k: v for k, v in patch.model_dump(exclude_unset=True).items() if k not in ("status", "priority", "labels") or v is not None}
    if service.update_ticket(db, ticket, admin, changes, {u.id for u in queue.staff(db)}):
        _notify_done(background, db, ticket)
    audit_record(db, admin, "ticket.update", f"ticket:{ticket.id}", ", ".join(sorted(changes)))


# ---- hazır yanıtlar (sabit yollar "/tickets/{id}"den önce tanımlı)


@router.get("/tickets/canned")
def list_canned(db: Session = Depends(get_db)):
    return canned.list_all(db)


@router.post("/tickets/canned", status_code=201)
def create_canned(payload: CannedIn, db: Session = Depends(get_db)):
    return canned.save(db, None, payload.title, payload.body)


@router.put("/tickets/canned/{reply_id}")
def update_canned(reply_id: int, payload: CannedIn, db: Session = Depends(get_db)):
    return canned.save(db, reply_id, payload.title, payload.body)


@router.delete("/tickets/canned/{reply_id}", status_code=204)
def delete_canned(reply_id: int, db: Session = Depends(get_db)):
    canned.delete(db, reply_id)


# ---- otomatik yakalanan hatalar


@router.get("/errors")
def list_errors(status: Literal["open", "all"] = "open", db: Session = Depends(get_db)):
    return errors.list_groups(db, status)


class ErrorAlertsIn(BaseModel):
    enabled: bool


@router.get("/errors/alerts")
def get_error_alerts():
    """Yeni hata e-postası açık mı (e-posta gönderimi yapılandırılmamışsa `configured` false)."""
    return {"enabled": alerts.enabled(), "configured": alerts.email_configured()}


@router.put("/errors/alerts")
def put_error_alerts(payload: ErrorAlertsIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    alerts.set_enabled(db, payload.enabled)
    audit_record(db, admin, "errors.alerts", "", "on" if payload.enabled else "off")
    return {"enabled": alerts.enabled(), "configured": alerts.email_configured()}


@router.patch("/errors/{group_id}", status_code=204)
def set_error_status(group_id: int, payload: ErrorStatusIn, db: Session = Depends(get_db)):
    if not errors.set_status(db, group_id, payload.status):
        raise HTTPException(404, "Not found")


# ---- talepler


@router.get("/tickets")
def list_tickets(
    view: Literal["open", "mine", "unassigned", "unread", "waiting", "overdue", "resolved", "all"] = "open", q: str = "", label: str = "", priority: str = "",
    category: str = "", page: int = 0, admin: User = Depends(admin_only), db: Session = Depends(get_db),
):
    return queue.list_page(db, admin, view=view, q=q, label=label, priority=priority, category=category, page=page)


@router.get("/tickets/options")
def ticket_options(db: Session = Depends(get_db)):
    """Etiketler, atanabilecek yöneticiler ve görünümler (ekran seçicileri bunlardan kurulur)."""
    return queue.options(db)


@router.get("/tickets/report")
def ticket_report(days: int = 30, db: Session = Depends(get_db)):
    return report.build(db, days)


@router.post("/tickets/bulk")
def bulk_update(payload: BulkIn, background: BackgroundTasks, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Seçilen taleplere aynı değişikliği uygular (ör. hepsini tamamla, birine ata, etiketle)."""
    done = 0
    for ticket_id in dict.fromkeys(payload.ids):
        ticket = db.scalar(select(Ticket).where(Ticket.id == ticket_id))
        if ticket is not None:
            _apply(db, background, admin, ticket, payload.changes)
            done += 1
    return {"updated": done}


@router.get("/tickets/attachments/{attachment_id}/url")
def attachment_url(attachment_id: int, db: Session = Depends(get_db)):
    return service.attachment_url(service.attachment(db, attachment_id))


@router.get("/tickets/{ticket_id}")
def ticket_detail(ticket_id: int, db: Session = Depends(get_db)):
    ticket = service.admin_ticket(db, ticket_id)
    if ticket.admin_unread:
        ticket.admin_unread = False
        db.commit()
    return queue.detail(db, ticket)


@router.post("/tickets/{ticket_id}/messages", status_code=201)
async def reply(
    ticket_id: int,
    request: Request,
    background: BackgroundTasks,
    body: str = Form(..., min_length=1, max_length=8000),
    internal: bool = Form(False),
    resolve: bool = Form(False),
    files: list[UploadFile] = File(default=[]),
    admin: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    """Kullanıcıya yanıt (ya da yalnızca yöneticilerin gördüğü iç not). `resolve`: yanıtla birlikte talebi tamamla."""
    check_size(request)
    ticket = service.admin_ticket(db, ticket_id)
    prepared = await read_uploads(files, service.MAX_FILES)
    service.add_message(db, ticket, "admin", body, prepared, internal=internal)
    owner = db.get(User, ticket.user_id)
    if resolve and not internal:
        service.set_status(db, ticket, "resolved", admin)
    if not internal:
        kind = "resolved" if ticket.status == "resolved" else "reply"
        background.add_task(service.notify_user, ticket.id, ticket.subject, owner.email, owner.email_lang, kind, body)
    audit_record(db, admin, "ticket.note" if internal else "ticket.reply", f"ticket:{ticket.id}")
    return queue.detail(db, service.admin_ticket(db, ticket_id))


@router.patch("/tickets/{ticket_id}")
def update_ticket(ticket_id: int, payload: TicketPatch, background: BackgroundTasks, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    ticket = service.admin_ticket(db, ticket_id)
    _apply(db, background, admin, ticket, payload)
    return queue.detail(db, service.admin_ticket(db, ticket_id))


@router.post("/tickets/{ticket_id}/resolve-group")
def resolve_group(ticket_id: int, background: BackgroundTasks, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Aynı hatayı bildiren tüm açık talepleri tamamlar ve her kullanıcıya bildirim gönderir."""
    ticket = service.admin_ticket(db, ticket_id)
    done = service.resolve_group(db, ticket)
    for t in done:
        _notify_done(background, db, t)
    audit_record(db, admin, "ticket.resolve_group", f"ticket:{ticket.id}", f"{len(done)} tickets")
    return queue.detail(db, service.admin_ticket(db, ticket_id))

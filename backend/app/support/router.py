"""Destek talepleri: giriş yapmış kullanıcının kendi talepleri için uçlar. Yönetici uçları admin_router.py'dedir."""
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.attachments import MAX_FILE_BYTES, read_uploads
from app.core.db import get_db
from app.core.deps import get_current_user
from app.support import errors, service

MAX_REQUEST_BYTES = service.MAX_FILES * MAX_FILE_BYTES + 256 * 1024

router = APIRouter(prefix="/api/support", tags=["support"])


class RatingIn(BaseModel):
    rating: int = Field(ge=-1, le=1)


class ErrorIn(BaseModel):
    message: str = Field(min_length=1, max_length=400)
    detail: str = Field(default="", max_length=2000)
    url: str = Field(default="", max_length=300)


def check_size(request: Request) -> None:
    if int(request.headers.get("content-length") or 0) > MAX_REQUEST_BYTES:
        raise HTTPException(413, "Files are too large (10 MB per file).")


@router.get("/tickets")
def my_tickets(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.list_for_user(db, user)


@router.get("/unread")
def my_unread(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"count": service.unread_count(db, user)}


@router.post("/tickets", status_code=201)
async def create_ticket(
    request: Request,
    background: BackgroundTasks,
    subject: str = Form(..., min_length=3, max_length=160),
    category: str = Form("question"),
    body: str = Form(..., min_length=5, max_length=8000),
    context: str = Form("{}", max_length=8000),
    files: list[UploadFile] = File(default=[]),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_size(request)
    prepared = await read_uploads(files, service.MAX_FILES)
    ticket = service.create_ticket(db, user, subject, category, body, service.clean_context(context), prepared)
    background.add_task(service.notify_team, ticket.id, ticket.subject, user.email, body, "new")
    return {"id": ticket.id}


@router.get("/tickets/{ticket_id}")
def my_ticket(ticket_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = service.user_ticket(db, user, ticket_id)
    if ticket.user_unread:
        ticket.user_unread = False
        db.commit()
    return service.user_detail(ticket)


@router.post("/tickets/{ticket_id}/messages", status_code=201)
async def reply(
    ticket_id: int,
    request: Request,
    background: BackgroundTasks,
    body: str = Form(..., min_length=1, max_length=8000),
    files: list[UploadFile] = File(default=[]),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_size(request)
    ticket = service.user_ticket(db, user, ticket_id)
    prepared = await read_uploads(files, service.MAX_FILES)
    service.add_message(db, ticket, "user", body, prepared)
    background.add_task(service.notify_team, ticket.id, ticket.subject, user.email, body, "reply")
    return service.user_detail(service.user_ticket(db, user, ticket_id))


@router.post("/tickets/{ticket_id}/resolve")
def mark_resolved(ticket_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Kullanıcı "kendim çözdüm / gerek kalmadı" der."""
    ticket = service.user_ticket(db, user, ticket_id)
    service.set_status(db, ticket, "resolved")
    ticket.user_unread = False
    db.commit()
    return service.user_detail(ticket)


@router.post("/tickets/{ticket_id}/rating")
def rate_ticket(ticket_id: int, payload: RatingIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = service.user_ticket(db, user, ticket_id)
    service.rate(db, ticket, payload.rating)
    return service.user_detail(ticket)


@router.get("/attachments/{attachment_id}/url")
def my_attachment_url(attachment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.attachment_url(service.user_attachment(db, user, attachment_id))


@router.post("/errors", status_code=204)
def report_error(payload: ErrorIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Tarayıcının yakaladığı beklenmeyen arayüz hatası (otomatik; kullanıcı talep açmak zorunda değil)."""
    errors.record(db, "client", payload.message, payload.detail, payload.url, user.id)

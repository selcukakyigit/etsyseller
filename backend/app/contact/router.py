import logging
import time
from collections import defaultdict, deque

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.contact.models import ContactMessage
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import require_admin

log = logging.getLogger("app.contact")
router = APIRouter(prefix="/api/contact", tags=["contact"])

TOPICS = {"support", "etsy", "billing", "privacy", "other"}
# IP başına saatte en fazla bu kadar mesaj. Bellek içi sayaç: tek instance için yeterli, çok instance'ta Redis'e taşınmalı.
MAX_PER_HOUR = 5
_hits: dict[str, deque[float]] = defaultdict(deque)


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    topic: str = "support"
    message: str = Field(min_length=10, max_length=5000)
    lang: str = "en"
    website: str = ""  # bal küpü (honeypot): insanlar görmez, botlar doldurur


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(ip: str) -> bool:
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= MAX_PER_HOUR:
        return True
    q.append(now)
    return False


def _notify(msg_id: int, name: str, email: str, topic: str, message: str) -> None:
    """Resend ayarlıysa ekibe e-posta gönderir; ayarlı değilse mesaj yalnızca veritabanında durur."""
    if not (settings.resend_api_key and settings.resend_from and settings.contact_to):
        return
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.resend_from,
                "to": [a.strip() for a in settings.contact_to.split(",") if a.strip()],
                "reply_to": email,
                "subject": f"[Ulagg iletişim #{msg_id}] {topic} - {name}",
                "text": f"Gönderen: {name} <{email}>\nKonu: {topic}\n\n{message}",
            },
            timeout=15,
        )
        resp.raise_for_status()
    except Exception:  # bildirim başarısız olsa da mesaj kaydedildi; kullanıcıya hata göstermeyiz
        log.exception("İletişim bildirimi gönderilemedi (#%s)", msg_id)


@router.post("", status_code=202)
def submit(payload: ContactIn, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    if payload.website:  # bot: sessizce başarılı gibi davran
        return {"ok": True}
    ip = _client_ip(request)
    if _rate_limited(ip):
        raise HTTPException(429, "Too many messages. Please try again later.")
    topic = payload.topic if payload.topic in TOPICS else "other"
    row = ContactMessage(
        name=payload.name.strip(),
        email=payload.email.lower(),
        topic=topic,
        message=payload.message.strip(),
        lang="tr" if payload.lang == "tr" else "en",
        ip=ip,
        user_agent=(request.headers.get("user-agent") or "")[:255],
    )
    db.add(row)
    db.commit()
    background.add_task(_notify, row.id, row.name, row.email, topic, row.message)
    return {"ok": True}


@router.get("/messages")
def list_messages(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(ContactMessage).order_by(ContactMessage.id.desc()).limit(200)).all()
    return [
        {"id": r.id, "name": r.name, "email": r.email, "topic": r.topic, "message": r.message, "handled": r.handled, "created_at": r.created_at.isoformat()}
        for r in rows
    ]

"""E-postayla yanıt: kullanıcı bildirim e-postasını yanıtlayınca, gelen kutusunu ileten sağlayıcının webhook'u buraya düşer ve
yanıt talebe kullanıcı mesajı olarak eklenir. Talep numarası konudaki "#12"den, gönderen ise talebin sahibinin e-postasından doğrulanır."""
import re
import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import settings
from app.core.db import get_db
from app.support import service
from app.support.models import Ticket

router = APIRouter(prefix="/api/support", tags=["support"])

_TICKET_ID = re.compile(r"#(\d{1,9})")
_ADDRESS = re.compile(r"<([^>]+)>|([^\s<>,;]+@[^\s<>,;]+)")
# Alıntılanan eski yazışmanın başladığı satırlar: bundan sonrası atılır.
_QUOTE_START = re.compile(r"^(on .+ wrote:|.+ tarihinde .+ yazdı:|-{2,}\s*original message|from:\s|>)", re.I)
MAX_BODY = 8000


def sender_email(raw: str) -> str:
    m = _ADDRESS.search(raw or "")
    return ((m.group(1) or m.group(2)) if m else "").strip().lower()


def strip_quoted(text: str) -> str:
    kept: list[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if _QUOTE_START.match(line.strip()):
            break
        kept.append(line)
    return "\n".join(kept).strip()[:MAX_BODY]


@router.post("/inbound")
async def inbound(request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Gelen e-posta webhook'u. Ortak sır `X-Inbound-Secret` başlığında ya da `?secret=` adresinde gelir. Gövde: JSON
    {from, subject, text}; sağlayıcı olayı `data` altında sarıyorsa o da kabul edilir. Eşleşmeyen e-postalar sessizce yok sayılır."""
    if not settings.support_inbound_secret:
        raise HTTPException(503, "Inbound email is not configured")
    given = request.headers.get("x-inbound-secret") or request.query_params.get("secret") or ""
    if not secrets.compare_digest(given, settings.support_inbound_secret):
        raise HTTPException(404, "Not found")
    payload = await request.json()
    data = payload.get("data", payload) if isinstance(payload, dict) else {}
    sender = sender_email(str(data.get("from", "")))
    match = _TICKET_ID.search(str(data.get("subject", "")))
    body = strip_quoted(str(data.get("text", "")))
    if not (sender and match and body):
        return {"ok": True}
    ticket = db.scalar(select(Ticket).where(Ticket.id == int(match.group(1))))
    owner = db.get(User, ticket.user_id) if ticket else None
    if ticket is None or owner is None or owner.email.lower() != sender:
        return {"ok": True}
    try:
        service.add_message(db, ticket, "user", body, [])
    except HTTPException:  # hız sınırı: akın eden e-posta sessizce atılır (sağlayıcı yeniden denemesin)
        return {"ok": True}
    background.add_task(service.notify_team, ticket.id, ticket.subject, owner.email, body, "reply")
    return {"ok": True}

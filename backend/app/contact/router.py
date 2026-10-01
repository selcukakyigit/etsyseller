import base64
import logging
import re
import secrets
import time
from collections import defaultdict, deque

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.contact.models import ContactAttachment, ContactMessage
from app.core import storage
from app.core.net import client_ip
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import require_admin

log = logging.getLogger("app.contact")
router = APIRouter(prefix="/api/contact", tags=["contact"])

TOPICS = {"support", "etsy", "billing", "privacy", "other"}
# IP başına saatte en fazla bu kadar mesaj. Bellek içi sayaç: tek instance için yeterli, çok instance'ta Redis'e taşınmalı.
MAX_PER_HOUR = 5
_hits: dict[str, deque[float]] = defaultdict(deque)

BUCKET = "contact-attachments"
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_FILES = 3
MAX_REQUEST_BYTES = MAX_FILES * MAX_FILE_BYTES + 256 * 1024
# uzantı -> (içerik türü, imza kontrolü). Dosya adındaki uzantıya değil içeriğin gerçek imzasına da bakılır.
ALLOWED: dict[str, tuple[str, str]] = {
    "jpg": ("image/jpeg", "jpeg"),
    "jpeg": ("image/jpeg", "jpeg"),
    "png": ("image/png", "png"),
    "gif": ("image/gif", "gif"),
    "webp": ("image/webp", "webp"),
    "pdf": ("application/pdf", "pdf"),
    "txt": ("text/plain", "text"),
    "csv": ("text/csv", "text"),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "zip"),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "zip"),
}
_email = TypeAdapter(EmailStr)


def _signature_ok(kind: str, data: bytes) -> bool:
    if kind == "jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if kind == "png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if kind == "gif":
        return data[:4] == b"GIF8"
    if kind == "webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if kind == "pdf":
        return data.lstrip()[:5] == b"%PDF-"
    if kind == "zip":
        return data[:4] == b"PK\x03\x04"
    if kind == "text":
        return b"\x00" not in data[:4096]
    return False


def _safe_name(name: str) -> str:
    base = re.sub(r"[^\w.\- ]+", "_", name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]).strip(" .")
    return (base or "file")[:120]


def _rate_limited(ip: str) -> bool:
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= MAX_PER_HOUR:
        return True
    q.append(now)
    return False


# Gmail'in alabileceği toplam ileti boyutu 25 MB ve ekler e-postada base64 ile ~%33 büyür. Güvenli sınır: ham ekler
# toplamı bu değeri aşarsa dosyalar e-postaya eklenmez, yalnızca (güvenli depodaki) indirme bağlantıları verilir.
MAX_EMAIL_ATTACH_BYTES = 12 * 1024 * 1024
LINK_TTL_SECONDS = 7 * 24 * 3600


def _notify(
    msg_id: int, name: str, email: str, topic: str, message: str,
    files: list[tuple[str, bytes]], stored: list[tuple[str, int, str]],
) -> None:
    """Resend ayarlıysa ekibe e-posta gönderir; ayarlı değilse mesaj yalnızca veritabanında durur.
    Ekler küçükse e-postaya eklenir; her durumda 7 gün geçerli indirme bağlantıları metne yazılır."""
    if not (settings.resend_api_key and settings.resend_from and settings.contact_to):
        return
    try:
        payload = {
            "from": settings.resend_from,
            "to": [a.strip() for a in settings.contact_to.split(",") if a.strip()],
            "reply_to": email,
            "subject": f"[Ulagg iletişim #{msg_id}] {topic} - {name}",
            "text": f"Gönderen: {name} <{email}>\nKonu: {topic}\n\n{message}",
        }
        if stored:
            lines = []
            for fname, size, path in stored:
                try:
                    lines.append(f"- {fname} ({size // 1024} KB): {storage.signed_url(BUCKET, path, LINK_TTL_SECONDS)}")
                except Exception:
                    lines.append(f"- {fname} ({size // 1024} KB): bağlantı üretilemedi")
            payload["text"] += "\n\nEkler (bağlantılar 7 gün geçerli):\n" + "\n".join(lines)
        if files and sum(len(d) for _, d in files) <= MAX_EMAIL_ATTACH_BYTES:
            payload["attachments"] = [{"filename": fn, "content": base64.b64encode(data).decode()} for fn, data in files]
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
    except Exception:  # bildirim başarısız olsa da mesaj kaydedildi; kullanıcıya hata göstermeyiz
        log.exception("İletişim bildirimi gönderilemedi (#%s)", msg_id)


@router.post("", status_code=202)
async def submit(
    request: Request,
    background: BackgroundTasks,
    name: str = Form(..., min_length=1, max_length=120),
    email: str = Form(...),
    message: str = Form(..., min_length=10, max_length=5000),
    topic: str = Form("support"),
    lang: str = Form("en"),
    website: str = Form(""),  # bal küpü (honeypot): insanlar görmez, botlar doldurur
    files: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    if website:  # bot: sessizce başarılı gibi davran
        return {"ok": True}
    if int(request.headers.get("content-length") or 0) > MAX_REQUEST_BYTES:
        raise HTTPException(413, "Files are too large (10 MB per file).")
    ip = client_ip(request)
    if _rate_limited(ip):
        raise HTTPException(429, "Too many messages. Please try again later.")
    try:
        email = str(_email.validate_python(email)).lower()
    except ValidationError as exc:
        raise HTTPException(422, "Invalid email address") from exc

    files = [f for f in files if f.filename]
    if len(files) > MAX_FILES:
        raise HTTPException(422, f"At most {MAX_FILES} files.")
    prepared: list[tuple[str, str, bytes]] = []  # (güvenli ad, içerik türü, bayt)
    for f in files:
        fname = _safe_name(f.filename or "file")
        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        if ext not in ALLOWED:
            raise HTTPException(422, f"File type not allowed: {fname}")
        data = await f.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, f"{fname} is larger than 10 MB.")
        ctype, kind = ALLOWED[ext]
        if not data or not _signature_ok(kind, data):
            raise HTTPException(422, f"File content does not match its type: {fname}")
        prepared.append((fname, ctype, data))

    row = ContactMessage(
        name=name.strip(),
        email=email,
        topic=topic if topic in TOPICS else "other",
        message=message.strip(),
        lang="tr" if lang == "tr" else "en",
        ip=ip,
        user_agent=(request.headers.get("user-agent") or "")[:255],
    )
    db.add(row)
    db.flush()

    if prepared:
        try:
            storage.ensure_bucket(BUCKET, MAX_FILE_BYTES)
            for fname, ctype, data in prepared:
                path = f"{row.id}/{secrets.token_hex(8)}-{fname}"
                storage.upload(BUCKET, path, data, ctype)
                row.attachments.append(ContactAttachment(filename=fname, content_type=ctype, size=len(data), storage_path=path))
        except Exception:  # depolama hatası mesajı engellemez; ekler e-postayla yine de gider
            log.exception("İletişim eki depolanamadı (#%s)", row.id)
    db.commit()

    stored = [(a.filename, a.size, a.storage_path) for a in row.attachments]
    background.add_task(_notify, row.id, row.name, row.email, row.topic, row.message, [(fn, d) for fn, _, d in prepared], stored)
    return {"ok": True}


@router.get("/messages")
def list_messages(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(ContactMessage).order_by(ContactMessage.id.desc()).limit(200)).all()
    return [
        {
            "id": r.id, "name": r.name, "email": r.email, "topic": r.topic, "message": r.message,
            "handled": r.handled, "created_at": r.created_at.isoformat(),
            "attachments": [{"id": a.id, "filename": a.filename, "size": a.size} for a in r.attachments],
        }
        for r in rows
    ]


@router.get("/attachments/{attachment_id}/url")
def attachment_url(attachment_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Yöneticiye 5 dakika geçerli, imzalı indirme adresi verir."""
    att = db.get(ContactAttachment, attachment_id)
    if att is None:
        raise HTTPException(404, "Ek bulunamadı")
    return {"url": storage.signed_url(BUCKET, att.storage_path), "filename": att.filename}

"""Tek gönderim noktası: Resend. Anahtar/adres ayarlı değilse sessizce atlar (yerel geliştirmede e-posta gitmez)."""
import base64
import logging

import httpx

from app.core.config import settings

log = logging.getLogger("app.emails")


def email_configured() -> bool:
    return bool(settings.resend_api_key and settings.resend_from)


def send_email(
    to: list[str],
    subject: str,
    html: str,
    text: str,
    reply_to: str | None = None,
    attachments: list[tuple[str, bytes]] | None = None,
) -> bool:
    """Gönderildiyse True. Hata fırlatmaz, loglar: e-posta başarısızlığı asıl işlemi (kayıt, mesaj kaydı) bozmamalı."""
    if not email_configured() or not to:
        return False
    payload: dict = {"from": settings.resend_from, "to": to, "subject": subject, "html": html, "text": text}
    if reply_to:
        payload["reply_to"] = reply_to
    if attachments:
        payload["attachments"] = [{"filename": fn, "content": base64.b64encode(data).decode()} for fn, data in attachments]
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        return True
    except Exception:
        log.exception("E-posta gönderilemedi: %s", subject)
        return False

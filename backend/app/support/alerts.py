"""Yeni (ya da çözülmüşken geri gelen) otomatik yakalanan hata için ekibe e-posta. Yönetim > Hatalar'daki anahtarla kapatılır (varsayılan açık).

Gürültü kuralları: yalnızca yeni hata grubu bildirilir (aynı hatanın tekrarı değil); süreç başına saatte en çok `MAX_PER_HOUR` e-posta gider,
fazlası atlanır (hatalar yine Hatalar sayfasında durur). Gönderim istek yolunu bekletmesin diye ayrı iş parçacığında yapılır. E-posta
yapılandırılmamışsa (yerel geliştirme, testler) hiçbir şey yapılmaz."""
import logging
import threading
import time

from app.core import app_settings
from app.core.config import settings
from app.emails.renderer import render
from app.emails.sender import email_configured, send_email

log = logging.getLogger("app.support.alerts")
KEY = "error_alerts"
MAX_PER_HOUR = 10
_lock = threading.Lock()
_sent: list[float] = []


def enabled() -> bool:
    return bool(app_settings.get(KEY, True))


def set_enabled(db, value: bool) -> None:
    app_settings.set_many(db, {KEY: bool(value)})


def _allowed() -> bool:
    now = time.monotonic()
    with _lock:
        _sent[:] = [t for t in _sent if now - t < 3600]
        if len(_sent) >= MAX_PER_HOUR:
            return False
        _sent.append(now)
        return True


def _send(message: str, source: str, url: str) -> None:
    to = [a.strip() for a in settings.contact_to.split(",") if a.strip()]
    if not to:
        return
    html, text = render(
        "error_alert.html", title="New error", preheader=message[:90], message=message,
        source="Server" if source == "server" else "Browser", url=url, link=f"{settings.frontend_url.rstrip('/')}/admin/errors",
    )
    send_email(to, f"[Ulagg error] {message[:80]}", html, text)


def notify(message: str, source: str, url: str = "") -> None:
    try:
        if not email_configured() or not enabled() or not _allowed():
            return
        threading.Thread(target=_send, args=(message, source, url), name="error-alert", daemon=True).start()
    except Exception:  # noqa: BLE001 — bildirim hatası asıl işlemi (hata kaydı) bozmaz
        log.exception("Hata bildirimi gönderilemedi")

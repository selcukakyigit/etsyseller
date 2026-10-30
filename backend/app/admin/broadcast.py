"""Yönetim > Duyuru: tüm aktif kullanıcılara e-posta ile hizmet duyurusu (bakım, önemli değişiklik). Pazarlama e-postası için değildir: alıcı onayı/abonelikten
çıkma yoktur, bu yüzden yalnızca hesapla ilgili hizmet bildirimleri içindir.

Güvenlik: göndermeden önce alıcı sayısı önizlenir ve gönderimde aynı sayı onaylanır (arada sayı değiştiyse gönderilmez); aynı anda tek gönderim çalışır ve
bir gönderimden sonra `COOLDOWN` dolmadan yenisi başlamaz (çift tıklama / yanlışlıkla ikinci gönderim). Her alıcı kendi diliyle alır (`users.email_lang`).
Gönderim ayrı iş parçacığında yapılır, her e-posta arasında kısa bekleme vardır (sağlayıcı hız sınırı). Durum bu sürecin belleğindedir: sunucu yeniden
başlarsa yarım kalan gönderim devam etmez (alıcı listesi tekrar önizlenip gönderilebilir)."""
import datetime as dt
import logging
import threading
import time

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.schemas import BroadcastIn, BroadcastPreviewOut, BroadcastStatusOut
from app.auth.access import UserAccess
from app.auth.models import User
from app.core.config import settings
from app.core.dates import iso
from app.emails.renderer import render
from app.emails.sender import email_configured, send_email

log = logging.getLogger("app.admin.broadcast")
PAUSE_SECONDS = 0.15
COOLDOWN = dt.timedelta(minutes=10)
MAX_RECIPIENTS = 20000

_lock = threading.Lock()
_state: dict = {"state": "idle", "total": 0, "sent": 0, "failed": 0, "started_at": None, "finished_at": None}


def _audience(db: Session) -> list[tuple[str, str]]:
    """(e-posta, dil) — askıda/engelli hesaplar hariç."""
    rows = db.execute(
        select(User.email, User.email_lang)
        .outerjoin(UserAccess, UserAccess.user_id == User.id)
        .where(or_(UserAccess.status.is_(None), UserAccess.status == "active"))
        .order_by(User.id).limit(MAX_RECIPIENTS)
    ).all()
    return [(email, "tr" if lang == "tr" else "en") for email, lang in rows if email]


def preview(db: Session) -> BroadcastPreviewOut:
    people = _audience(db)
    tr = sum(1 for _, lang in people if lang == "tr")
    return BroadcastPreviewOut(recipients=len(people), tr=tr, en=len(people) - tr, configured=email_configured())


def status() -> BroadcastStatusOut:
    with _lock:
        return BroadcastStatusOut(
            state=_state["state"], total=_state["total"], sent=_state["sent"], failed=_state["failed"], started_at=iso(_state["started_at"]),
        )


def _mail(data: BroadcastIn, lang: str, to: str) -> bool:
    tr = lang == "tr"
    subject, body = (data.subject_tr, data.body_tr) if tr else (data.subject_en, data.body_en)
    html, text = render(
        "broadcast.html", title=subject, preheader=body[:90], subject=subject, body=body,
        footer="Bu e-posta Ulagg hesabınızla ilgili bir hizmet bildirimidir." if tr else "This is a service message about your Ulagg account.",
    )
    reply_to = next((a.strip() for a in settings.contact_to.split(",") if a.strip()), None)
    return send_email([to], subject, html, text, reply_to=reply_to)


def send_test(admin: User, data: BroadcastIn) -> None:
    """Yalnızca yöneticinin kendi adresine, her iki dilde birer e-posta."""
    if not email_configured():
        raise AdminError(503, "E-posta gönderimi yapılandırılmamış.")
    if not all([_mail(data, "tr", admin.email), _mail(data, "en", admin.email)]):
        raise AdminError(502, "Yanıt gönderilemedi.")


def _run(people: list[tuple[str, str]], data: BroadcastIn) -> None:
    try:
        for email, lang in people:
            ok = False
            try:
                ok = _mail(data, lang, email)
            except Exception:  # noqa: BLE001 — bir alıcının hatası gönderimi durdurmaz
                log.exception("Duyuru e-postası hazırlanamadı")
            with _lock:
                _state["sent" if ok else "failed"] += 1
            time.sleep(PAUSE_SECONDS)
    finally:
        with _lock:
            _state["state"] = "done"
            _state["finished_at"] = dt.datetime.utcnow()


def start(db: Session, data: BroadcastIn, confirm_count: int) -> BroadcastStatusOut:
    if not email_configured():
        raise AdminError(503, "E-posta gönderimi yapılandırılmamış.")
    people = _audience(db)
    if confirm_count != len(people):
        raise AdminError(409, "Alıcı sayısı değişti, önizlemeyi yenileyip tekrar onaylayın.")
    if not people:
        raise AdminError(422, "Gönderilecek alıcı yok.")
    with _lock:
        if _state["state"] == "sending":
            raise AdminError(409, "Bir duyuru zaten gönderiliyor.")
        finished = _state["finished_at"]
        if finished and dt.datetime.utcnow() - finished < COOLDOWN:
            raise AdminError(429, "Yeni duyuru için birkaç dakika bekleyin.")
        _state.update({"state": "sending", "total": len(people), "sent": 0, "failed": 0, "started_at": dt.datetime.utcnow(), "finished_at": None})
    threading.Thread(target=_run, args=(people, data), name="broadcast-email", daemon=True).start()
    return status()

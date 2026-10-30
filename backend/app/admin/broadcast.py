"""Yönetim > Duyuru > E-postalar: tüm aktif kullanıcılara e-posta ile hizmet duyurusu (bakım, önemli değişiklik). Pazarlama e-postası için değildir: alıcı
onayı/abonelikten çıkma yoktur, bu yüzden yalnızca hesapla ilgili hizmet bildirimleri içindir. Taslak, ilerleme ve sonuç `email_broadcasts` tablosunda durur
(gönderilmiş kayıt değişmez, geçmiş olarak kalır).

Güvenlik: göndermeden önce alıcı sayısı önizlenir ve gönderimde aynı sayı onaylanır (arada sayı değiştiyse gönderilmez); aynı anda tek gönderim çalışır ve
bir gönderimden sonra `COOLDOWN` dolmadan yenisi başlamaz (çift tıklama / yanlışlıkla ikinci gönderim). Her alıcı kendi diliyle alır (`users.email_lang`).
Gönderim ayrı iş parçacığında yapılır, her e-posta arasında kısa bekleme vardır (sağlayıcı hız sınırı). Sunucu yeniden başlarsa yarım kalan gönderim devam
etmez: açılışta `recover()` onu "yarım kaldı" işaretler (kimlere gittiği tutulmadığı için aynı kayıt yeniden gönderilmez; yeni taslakla gönderilir)."""
import datetime as dt
import logging
import threading
import time

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.models import EmailBroadcast
from app.admin.schemas import BroadcastIn, BroadcastOut, BroadcastPreviewOut
from app.auth.access import UserAccess
from app.auth.models import User
from app.core.config import settings
from app.core.dates import iso
from app.core.db import SessionLocal
from app.emails.renderer import render
from app.emails.sender import email_configured, send_email

log = logging.getLogger("app.admin.broadcast")
PAUSE_SECONDS = 0.15
COOLDOWN = dt.timedelta(minutes=10)
MAX_RECIPIENTS = 20000
MAX_ROWS = 100
SAVE_EVERY = 10  # ilerleme bu kadar alıcıda bir veritabanına yazılır


def _out(row: EmailBroadcast) -> BroadcastOut:
    return BroadcastOut(
        id=row.id, subject_tr=row.subject_tr, subject_en=row.subject_en, body_tr=row.body_tr, body_en=row.body_en, status=row.status,
        total=row.total, sent=row.sent, failed=row.failed, created_by=row.created_by, created_at=iso(row.created_at),
        started_at=iso(row.started_at), finished_at=iso(row.finished_at),
    )


def _get(db: Session, broadcast_id: int) -> EmailBroadcast:
    row = db.get(EmailBroadcast, broadcast_id)
    if row is None:
        raise AdminError(404, "E-posta bulunamadı")
    return row


def _complete(data) -> None:
    """Test ve gönderim için konu ve metin iki dilde de dolu olmalı (taslak yarım kaydedilebilir)."""
    if min(len(data.subject_tr.strip()), len(data.subject_en.strip())) < 3 or min(len(data.body_tr.strip()), len(data.body_en.strip())) < 10:
        raise AdminError(422, "Konu ve metin iki dilde de doldurulmalı.")


def _draft(row: EmailBroadcast) -> EmailBroadcast:
    if row.status != "draft":
        raise AdminError(409, "Yalnızca taslak değiştirilebilir.")
    return row


def _apply(row: EmailBroadcast, data: BroadcastIn) -> None:
    row.subject_tr, row.subject_en = data.subject_tr.strip(), data.subject_en.strip()
    row.body_tr, row.body_en = data.body_tr.strip(), data.body_en.strip()


def list_all(db: Session) -> list[BroadcastOut]:
    return [_out(r) for r in db.scalars(select(EmailBroadcast).order_by(EmailBroadcast.id.desc()).limit(MAX_ROWS)).all()]


def create(db: Session, admin: User, data: BroadcastIn) -> BroadcastOut:
    row = EmailBroadcast(created_by=admin.email)
    _apply(row, data)
    db.add(row)
    db.commit()
    return _out(row)


def update(db: Session, broadcast_id: int, data: BroadcastIn) -> BroadcastOut:
    row = _draft(_get(db, broadcast_id))
    _apply(row, data)
    db.commit()
    return _out(row)


def delete(db: Session, broadcast_id: int) -> None:
    db.delete(_draft(_get(db, broadcast_id)))
    db.commit()


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


def _mail(data, lang: str, to: str) -> bool:
    tr = lang == "tr"
    subject, body = (data.subject_tr, data.body_tr) if tr else (data.subject_en, data.body_en)
    html, text = render(
        "broadcast.html", title=subject, preheader=body[:90], subject=subject, body=body,
        footer="Bu e-posta Ulagg hesabınızla ilgili bir hizmet bildirimidir." if tr else "This is a service message about your Ulagg account.",
    )
    reply_to = next((a.strip() for a in settings.contact_to.split(",") if a.strip()), None)
    return send_email([to], subject, html, text, reply_to=reply_to)


def send_test(admin: User, data: BroadcastIn) -> None:
    """Yalnızca yöneticinin kendi adresine, her iki dilde birer e-posta (editördeki güncel metinle; taslağı kaydetmez)."""
    _complete(data)
    if not email_configured():
        raise AdminError(503, "E-posta gönderimi yapılandırılmamış.")
    if not all([_mail(data, "tr", admin.email), _mail(data, "en", admin.email)]):
        raise AdminError(502, "Yanıt gönderilemedi.")


def _run(broadcast_id: int, people: list[tuple[str, str]]) -> None:
    """Ayrı iş parçacığı: kendi oturumuyla gönderir, ilerlemeyi periyodik yazar, bitince "done" yapar."""
    sent = failed = 0
    with SessionLocal() as db:
        row = db.get(EmailBroadcast, broadcast_id)
        try:
            for i, (email, lang) in enumerate(people, 1):
                ok = False
                try:
                    ok = _mail(row, lang, email)
                except Exception:  # noqa: BLE001 — bir alıcının hatası gönderimi durdurmaz
                    log.exception("Duyuru e-postası hazırlanamadı")
                sent, failed = sent + ok, failed + (not ok)
                if i % SAVE_EVERY == 0:
                    row.sent, row.failed = sent, failed
                    db.commit()
                time.sleep(PAUSE_SECONDS)
        finally:
            row.sent, row.failed, row.status, row.finished_at = sent, failed, "done", dt.datetime.utcnow()
            db.commit()


def start(db: Session, broadcast_id: int, confirm_count: int) -> BroadcastOut:
    row = _draft(_get(db, broadcast_id))
    _complete(row)
    if not email_configured():
        raise AdminError(503, "E-posta gönderimi yapılandırılmamış.")
    people = _audience(db)
    if confirm_count != len(people):
        raise AdminError(409, "Alıcı sayısı değişti, önizlemeyi yenileyip tekrar onaylayın.")
    if not people:
        raise AdminError(422, "Gönderilecek alıcı yok.")
    if db.scalar(select(EmailBroadcast.id).where(EmailBroadcast.status == "sending").limit(1)) is not None:
        raise AdminError(409, "Bir duyuru zaten gönderiliyor.")
    last = db.scalar(select(func.max(EmailBroadcast.finished_at)))
    if last is not None and dt.datetime.utcnow() - last < COOLDOWN:
        raise AdminError(429, "Yeni duyuru için birkaç dakika bekleyin.")
    row.status, row.total, row.sent, row.failed, row.started_at = "sending", len(people), 0, 0, dt.datetime.utcnow()
    db.commit()
    threading.Thread(target=_run, args=(row.id, people), name="broadcast-email", daemon=True).start()
    return _out(row)


def recover(db: Session) -> None:
    """Açılışta: önceki süreçte yarım kalmış gönderimleri "yarım kaldı" işaretler (iş parçacığı o süreçle birlikte öldü)."""
    for row in db.scalars(select(EmailBroadcast).where(EmailBroadcast.status == "sending")).all():
        row.status, row.finished_at = "interrupted", dt.datetime.utcnow()
    db.commit()


def recover_on_startup() -> None:
    """Açılış kancası: tablo yoksa ya da veritabanı o an kapalıysa uygulamanın açılmasını engellemez."""
    try:
        with SessionLocal() as db:
            recover(db)
    except Exception:  # noqa: BLE001
        log.exception("Yarım kalan duyuru gönderimleri kontrol edilemedi")

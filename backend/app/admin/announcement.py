"""Uygulama içi duyurular (bakım, yeni özellik…). Yönetici panelden listeler, ekler, düzenler, açıp kapatır; aktif ve süresi dolmamış olanların hepsi giriş
yapmış kullanıcılara `/api/site/announcement` ile (alt alta bant olarak) gösterilir."""
import datetime as dt
import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.models import Announcement
from app.admin.schemas import AnnouncementIn, AnnouncementOut
from app.core.dates import iso

MAX_ROWS = 200


def _ends(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AdminError(422, "Bitiş zamanı geçersiz.") from exc
    return parsed.astimezone(dt.timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed


def _expired(row: Announcement, now: dt.datetime) -> bool:
    return row.ends_at is not None and row.ends_at <= now


def _out(row: Announcement, now: dt.datetime) -> AnnouncementOut:
    return AnnouncementOut(
        id=row.id, active=row.active, tone=row.tone, text_tr=row.text_tr, text_en=row.text_en, ends_at=iso(row.ends_at),
        expired=_expired(row, now), created_at=iso(row.created_at),
    )


def _get(db: Session, announcement_id: int) -> Announcement:
    row = db.get(Announcement, announcement_id)
    if row is None:
        raise AdminError(404, "Duyuru bulunamadı")
    return row


def _apply(row: Announcement, data: AnnouncementIn) -> None:
    if not (data.text_tr.strip() and data.text_en.strip()):
        raise AdminError(422, "Duyuru için iki dilde de metin yazın.")
    row.tone, row.text_tr, row.text_en = data.tone, data.text_tr.strip(), data.text_en.strip()
    row.active, row.ends_at, row.updated_at = data.active, _ends(data.ends_at), dt.datetime.utcnow()


def list_all(db: Session) -> list[AnnouncementOut]:
    now = dt.datetime.utcnow()
    rows = db.scalars(select(Announcement).order_by(Announcement.id.desc()).limit(MAX_ROWS)).all()
    return [_out(r, now) for r in rows]


def create(db: Session, data: AnnouncementIn) -> AnnouncementOut:
    row = Announcement(text_tr="", text_en="")
    _apply(row, data)
    db.add(row)
    db.commit()
    return _out(row, dt.datetime.utcnow())


def update(db: Session, announcement_id: int, data: AnnouncementIn) -> AnnouncementOut:
    row = _get(db, announcement_id)
    _apply(row, data)
    db.commit()
    return _out(row, dt.datetime.utcnow())


def delete(db: Session, announcement_id: int) -> None:
    db.delete(_get(db, announcement_id))
    db.commit()


def current(db: Session) -> list[dict]:
    """Şu an gösterilecek duyurular (herkese açık okuma), yeniden eskiye. `id` metin değişince değişir: kullanıcının "kapat" seçimi yeni metinde sıfırlanır."""
    now = dt.datetime.utcnow()
    rows = db.scalars(select(Announcement).where(Announcement.active.is_(True)).order_by(Announcement.id.desc()).limit(10)).all()
    return [
        {"id": f"{r.id}-{hashlib.sha1(f'{r.tone}|{r.text_tr}|{r.text_en}'.encode()).hexdigest()[:8]}", "tone": r.tone, "text_tr": r.text_tr, "text_en": r.text_en}
        for r in rows if not _expired(r, now)
    ]

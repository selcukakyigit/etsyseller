"""Uygulama içi duyuru bandı (bakım, yeni özellik…). Tek duyuru, `app_settings` tablosunda JSON olarak durur (göç gerekmez); yönetici panelden
yazar, giriş yapmış herkes `/api/site/announcement` ile okur. Süresi dolan ya da kapalı duyuru herkese boş döner."""
import datetime as dt
import hashlib
from typing import Any

from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.schemas import AnnouncementIn, AnnouncementOut
from app.core import app_settings

KEY = "announcement"
EMPTY: dict[str, Any] = {"active": False, "tone": "info", "text_tr": "", "text_en": "", "ends_at": None}


def _stored() -> dict[str, Any]:
    value = app_settings.get(KEY, {})
    return {**EMPTY, **value} if isinstance(value, dict) else dict(EMPTY)


def _ends(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AdminError(422, "Bitiş zamanı geçersiz.") from exc
    return parsed.astimezone(dt.timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed


def get() -> AnnouncementOut:
    return AnnouncementOut(**_stored())


def save(db: Session, data: AnnouncementIn) -> AnnouncementOut:
    _ends(data.ends_at)
    if data.active and not (data.text_tr.strip() and data.text_en.strip()):
        raise AdminError(422, "Duyuruyu açmak için iki dilde de metin yazın.")
    app_settings.set_many(db, {KEY: {**data.model_dump(), "text_tr": data.text_tr.strip(), "text_en": data.text_en.strip()}})
    return get()


def current() -> dict[str, Any] | None:
    """Şu an gösterilecek duyuru (herkese açık okuma); yoksa None."""
    value = _stored()
    if not value["active"] or not (value["text_tr"] and value["text_en"]):
        return None
    ends = _ends(value["ends_at"])
    if ends is not None and ends <= dt.datetime.utcnow():
        return None
    # `id`: metin değişince ön yüzdeki "kapat" seçimi sıfırlansın diye içerikten türer.
    return {"id": hashlib.sha1(f'{value["tone"]}|{value["text_tr"]}|{value["text_en"]}'.encode()).hexdigest()[:10], "tone": value["tone"], "text_tr": value["text_tr"], "text_en": value["text_en"]}

"""Saklama süresi dolan kayıtların silinmesi. Gizlilik Politikası / KVKK metnindeki taahhüdün uygulaması:
iletişim formu mesajları ve ekleri 12 ay sonra silinir. Bildirimler 90 gün sonra silinir."""
import datetime as dt
import logging

from sqlalchemy import select

from app.contact.models import ContactMessage
from app.contact.router import BUCKET
from app.core import storage
from app.core.db import SessionLocal
from app.notifications.service import purge_old as purge_old_notifications

logger = logging.getLogger(__name__)

CONTACT_RETENTION = dt.timedelta(days=365)


def purge_expired_records() -> None:
    db = SessionLocal()
    try:
        cutoff = dt.datetime.utcnow() - CONTACT_RETENTION
        expired = db.scalars(select(ContactMessage).where(ContactMessage.created_at < cutoff).limit(500)).all()
        removed = 0
        for msg in expired:
            try:
                for att in msg.attachments:
                    storage.delete(BUCKET, att.storage_path)  # önce dosyalar: başarısızsa satır kalır, sonraki gün tekrar denenir
            except Exception:
                logger.exception("İletişim eki silinemedi (#%s), yarın tekrar denenecek", msg.id)
                continue
            db.delete(msg)  # ekler cascade ile silinir
            removed += 1
        db.commit()
        if removed:
            logger.info("Saklama süresi dolan %s iletişim mesajı silindi", removed)
        if n := purge_old_notifications(db):
            logger.info("90 günden eski %s bildirim silindi", n)
    except Exception:
        logger.exception("Saklama süresi temizliği başarısız")
        db.rollback()
    finally:
        db.close()

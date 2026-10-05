"""Saklama süresi dolan kayıtların silinmesi. Gizlilik Politikası / KVKK metnindeki taahhüdün uygulaması:
iletişim formu mesajları ve ekleri 12 ay sonra silinir. Bildirimler 90 gün sonra silinir. Asistan sohbet ekleri 90 gün,
hiç açılmayan sohbetler 12 ay sonra silinir (assistant/cleanup.py).
Etsy API Şartları (veri gerektiğinden uzun saklanmaz): satıcı Ulagg'ı Etsy'den kaldırdıysa ve REVOKED_GRACE içinde yeniden
bağlanmadıysa mağazanın Etsy'den gelen verisi, "bağlantıyı kes" ile aynı şekilde silinir (shops/disconnect.py)."""
import datetime as dt
import logging

from sqlalchemy import select

from app.assistant.cleanup import purge_expired as purge_assistant_data
from app.contact.models import ContactMessage
from app.contact.router import BUCKET
from app.core import storage
from app.core.db import SessionLocal
from app.notifications.service import purge_old as purge_old_notifications
from app.shops.disconnect import disconnect_shop
from app.shops.models import OAuthToken, Shop

logger = logging.getLogger(__name__)

CONTACT_RETENTION = dt.timedelta(days=365)
REVOKED_GRACE = dt.timedelta(days=30)


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
        try:
            purge_assistant_data(db)
        except Exception:  # sonraki adımı (erişimi kaldırılmış mağazalar) engellemesin
            logger.exception("Asistan saklama temizliği başarısız")
            db.rollback()
        revoked = db.scalars(
            select(Shop).join(OAuthToken, OAuthToken.shop_id == Shop.id).where(Shop.access_revoked_at < dt.datetime.utcnow() - REVOKED_GRACE)
        ).all()
        for shop in revoked:
            disconnect_shop(db, shop)
            logger.info("Mağaza %s: Etsy erişimi %s gün önce kaldırılmış, Etsy verisi silindi", shop.id, REVOKED_GRACE.days)
    except Exception:
        logger.exception("Saklama süresi temizliği başarısız")
        db.rollback()
    finally:
        db.close()

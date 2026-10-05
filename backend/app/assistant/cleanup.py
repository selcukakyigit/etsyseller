"""Asistan verisinin silinmesi ve saklama süreleri (Gizlilik Politikası / KVKK'daki taahhüdün uygulaması).

- Yüklenip hiçbir mesaja eklenmeyen dosyalar ORPHAN_AFTER sonra silinir (sohbeti silinmiş dosyalar da).
- Sohbet ekleri (resim, PDF, Excel) ATTACHMENT_RETENTION sonra depodan silinir; mesaj kalır, ekte "süresi doldu" görünür.
  Taslağa eklenen resimler taslağa KOPYALANDIĞI için etkilenmez (bkz. tools.create_listing_draft).
- SESSION_RETENTION boyunca hiç açılmayan (yeni mesaj yazılmayan) sohbetler dosyalarıyla birlikte silinir.
- Etsy bağlantısı kesilince mağazanın tüm sohbetleri silinir: kartlarda sipariş/alıcı bilgisi gibi Etsy verisi bulunur.
  Mağaza notları (memory.py) kullanıcının kendi tercihleridir, kalır; Ayarlar > Yapay Zekâ'dan silinebilir."""
import datetime as dt
import logging

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.assistant.models import ChatImage, ChatMessage, ChatSession
from app.core import blobstore

log = logging.getLogger(__name__)

ORPHAN_AFTER = dt.timedelta(hours=24)
ATTACHMENT_RETENTION = dt.timedelta(days=90)
SESSION_RETENTION = dt.timedelta(days=365)
BATCH = 500


def delete_sessions(db: Session, session_ids: list[int]) -> None:
    """Sohbetleri mesajları ve dosyalarıyla siler. Önce satırlar (commit), sonra depodaki dosyalar."""
    if not session_ids:
        return
    paths = [p for p in db.scalars(select(ChatImage.path).where(ChatImage.session_id.in_(session_ids))) if p]
    db.execute(delete(ChatImage).where(ChatImage.session_id.in_(session_ids)))
    db.execute(delete(ChatMessage).where(ChatMessage.session_id.in_(session_ids)))
    db.execute(delete(ChatSession).where(ChatSession.id.in_(session_ids)))
    db.commit()
    blobstore.remove(paths)


def purge_shop_chats(db: Session, shop_id: int) -> None:
    """Etsy bağlantısı kesilince: mağazanın tüm sohbetleri ve sohbet dosyaları (gönderilmemişler dahil)."""
    delete_sessions(db, list(db.scalars(select(ChatSession.id).where(ChatSession.shop_id == shop_id))))
    paths = [p for p in db.scalars(select(ChatImage.path).where(ChatImage.shop_id == shop_id)) if p]
    db.execute(delete(ChatImage).where(ChatImage.shop_id == shop_id))
    db.commit()
    blobstore.remove(paths)


def purge_expired(db: Session, now: dt.datetime | None = None) -> dict[str, int]:
    """Günlük saklama işi (jobs/retention.py). Her adım en fazla BATCH kayıt işler; kalanlar ertesi gün."""
    now = now or dt.datetime.utcnow()

    stale = list(db.scalars(select(ChatSession.id).where(ChatSession.updated_at < now - SESSION_RETENTION).limit(BATCH)))
    delete_sessions(db, stale)

    live_sessions = select(ChatSession.id)
    orphans = db.scalars(
        select(ChatImage).where(
            or_(
                (ChatImage.session_id.is_(None)) & (ChatImage.created_at < now - ORPHAN_AFTER),
                ChatImage.session_id.is_not(None) & ChatImage.session_id.not_in(live_sessions),
            )
        ).limit(BATCH)
    ).all()
    orphan_paths = [i.path for i in orphans if i.path]
    for i in orphans:
        db.delete(i)
    db.commit()
    blobstore.remove(orphan_paths)

    expired = db.scalars(select(ChatImage).where(ChatImage.path != "", ChatImage.created_at < now - ATTACHMENT_RETENTION).limit(BATCH)).all()
    expired_paths = [i.path for i in expired]
    for i in expired:
        i.path = ""  # mesaj kalır; arayüz eki "süresi doldu" olarak gösterir
    db.commit()
    blobstore.remove(expired_paths)

    counts = {"sessions": len(stale), "orphans": len(orphans), "attachments": len(expired)}
    if any(counts.values()):
        log.info("Asistan saklama temizliği: %s", counts)
    return counts

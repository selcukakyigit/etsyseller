"""Geri alınamaz hesap işlemleri: "tüm verileri sıfırla" ve "hesabı sil". Her ikisi de hesap şifresi ister.

Etsy'deki mağazanın kendisine dokunulmaz — silinen yalnızca bu uygulamadaki yerel kopyalar/kayıtlardır. `.env`'deki
API anahtarları uygulama geneli ayardır (kullanıcıya ait değil), o yüzden silinmez.
"""
import shutil
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.account.service import AVATAR_DIR, WrongPassword
from app.auth.models import User
from app.core.db import Base
from app.core.security import verify_password
from app.shops.models import Shop

UPLOADS = Path(__file__).resolve().parents[2] / "uploads"
# mağaza başına diskte tutulan klasörler: <uploads>/<ad>/<shop_id>
SHOP_UPLOAD_FOLDERS = ("drafts", "image-cache", "chat")
# kullanıcıya/mağazaya bağlı ama shop_id taşımayan ya da silinmemesi gereken tablolar
SKIP_TABLES = {"shops", "users", "sessions", "oauth_states"}


def verify(user: User, password: str) -> None:
    if not verify_password(password, user.password_hash):
        raise WrongPassword("Şifre yanlış")


def _wipe_shops(db: Session, shop_ids: list[int]) -> None:
    """Verilen mağazaların tüm yerel verisini (tablolar + diskteki dosyalar + bellek önbellekleri) siler."""
    if shop_ids:
        # Bağımlılık sırasının tersi: önce alt tablolar. Sohbet mesajları shop_id taşımaz, oturumları üzerinden silinir.
        for table in reversed(Base.metadata.sorted_tables):
            if table.name in SKIP_TABLES:
                continue
            if "shop_id" in table.c:
                db.execute(delete(table).where(table.c.shop_id.in_(shop_ids)))
            elif table.name == "chat_messages":
                sessions = Base.metadata.tables["chat_sessions"]
                db.execute(delete(table).where(table.c.session_id.in_(select(sessions.c.id).where(sessions.c.shop_id.in_(shop_ids)))))
        db.execute(delete(Shop).where(Shop.id.in_(shop_ids)))
    db.commit()

    from app.finance import service as finance_service  # bellekteki rapor önbelleği aynı id'yi yeniden kullanan yeni mağazaya sızmasın

    for sid in shop_ids:
        finance_service._finance_cache.pop(sid, None)
        for folder in SHOP_UPLOAD_FOLDERS:
            shutil.rmtree(UPLOADS / folder / str(sid), ignore_errors=True)


def _shop_ids(db: Session, user: User) -> list[int]:
    return list(db.scalars(select(Shop.id).where(Shop.user_id == user.id)))


def reset_data(db: Session, user: User) -> None:
    """Hesap açık, şifre/profil aynı kalır; bağlı mağazalar ve onlara ait TÜM veri silinir — hesap yeni açılmış gibi olur."""
    _wipe_shops(db, _shop_ids(db, user))
    db.execute(delete(Base.metadata.tables["oauth_states"]).where(Base.metadata.tables["oauth_states"].c.user_id == user.id))
    db.commit()


def delete_account(db: Session, user: User) -> None:
    """Kullanıcı, oturumları, mağazaları ve tüm verisi (profil fotoğrafı dahil) kalıcı olarak silinir."""
    reset_data(db, user)
    if user.avatar_filename:
        (AVATAR_DIR / user.avatar_filename).unlink(missing_ok=True)
    db.expire_all()
    db.delete(db.get(User, user.id))
    db.commit()

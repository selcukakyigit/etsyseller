"""Geri alınamaz hesap işlemleri: "tüm verileri sıfırla" ve "hesabı sil". İkisi de hesabın e-postasını yazarak onay ister.

Etsy'deki mağazanın kendisine dokunulmaz — silinen yalnızca bu uygulamadaki yerel kopyalar/kayıtlardır. `.env`'deki
API anahtarları uygulama geneli ayardır (kullanıcıya ait değil), o yüzden silinmez.
"""
import shutil
from pathlib import Path

import httpx
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.account.service import AVATAR_DIR
from app.auth.models import User, Workspace, WorkspaceMember
from app.auth.workspaces import workspace_ids
from app.billing import service as billing_service
from app.core import blobstore
from app.core.config import settings
from app.core.db import Base
from app.shops.models import Shop

UPLOADS = Path(__file__).resolve().parents[2] / "uploads"
# mağaza başına diskte tutulan klasörler: <uploads>/<ad>/<shop_id>
SHOP_UPLOAD_FOLDERS = ("drafts", "image-cache", "chat")
# kullanıcıya/mağazaya bağlı ama shop_id taşımayan ya da silinmemesi gereken tablolar
SKIP_TABLES = {"shops", "users", "oauth_states", "workspaces", "workspace_members", "user_consents"}


class WrongConfirmation(Exception):
    pass


def verify(user: User, typed_email: str) -> None:
    if typed_email.strip().lower() != user.email.lower():
        raise WrongConfirmation("Yazdığınız e-posta hesabınızla eşleşmiyor")


def _wipe_shops(db: Session, shop_ids: list[int]) -> None:
    """Verilen mağazaların tüm yerel verisini (tablolar + diskteki dosyalar + bellek önbellekleri) siler."""
    files: list[str] = []
    if shop_ids:
        # Kalıcı depodaki dosyalar (taslak fotoğrafları, asistan resimleri): satırlar silinmeden önce yolları alınır.
        for name in ("listing_draft_files", "chat_images"):
            t = Base.metadata.tables.get(name)
            if t is not None:
                files += list(db.scalars(select(t.c.path).where(t.c.shop_id.in_(shop_ids))))
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

    blobstore.remove(files)
    for sid in shop_ids:
        finance_service._finance_cache.pop(sid, None)
        for folder in SHOP_UPLOAD_FOLDERS:
            shutil.rmtree(UPLOADS / folder / str(sid), ignore_errors=True)


def _shop_ids(db: Session, user: User) -> list[int]:
    return list(db.scalars(select(Shop.id).where(Shop.workspace_id.in_(workspace_ids(db, user)))))


def reset_data(db: Session, user: User) -> None:
    """Hesap açık, profil aynı kalır; bağlı mağazalar ve onlara ait TÜM veri silinir — hesap yeni açılmış gibi olur."""
    _wipe_shops(db, _shop_ids(db, user))
    db.execute(delete(Base.metadata.tables["oauth_states"]).where(Base.metadata.tables["oauth_states"].c.user_id == user.id))
    db.commit()


def _delete_supabase_user(supabase_id: str) -> None:
    if not (settings.supabase_url and settings.supabase_secret_key):
        raise RuntimeError("Supabase yapılandırılmamış")
    resp = httpx.delete(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{supabase_id}",
        headers={"apikey": settings.supabase_secret_key, "Authorization": f"Bearer {settings.supabase_secret_key}"},
        timeout=20,
    )
    if resp.status_code not in (200, 204, 404):
        raise RuntimeError(f"Supabase kullanıcısı silinemedi ({resp.status_code})")


def delete_account(db: Session, user: User) -> None:
    """Kullanıcı, kişisel çalışma alanı, mağazaları ve tüm verisi (profil fotoğrafı ve Supabase kimliği dahil) silinir."""
    supabase_id = user.supabase_id
    avatar = user.avatar_filename
    owned_workspaces = list(
        db.scalars(select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id, WorkspaceMember.role == "owner"))
    )
    # Önce abonelikler iptal edilir: iptal edilemezse hiçbir şey silinmez, silinmiş hesaptan ödeme alınmaya devam edilmez.
    try:
        billing_service.cancel_for_workspaces(db, owned_workspaces)
    except SQLAlchemyError:  # ödeme tabloları henüz yoksa abonelik de yoktur
        db.rollback()
    reset_data(db, user)
    # Kimlik kaydı, yerel kullanıcı satırı silinmeden önce kaldırılır: Supabase hata verirse kullanıcı satırı durur ve
    # işlem tekrar denenebilir (giriş açık kalıp verisi silinmiş yarım durum tutarlı biçimde yeniden denenir).
    _delete_supabase_user(supabase_id)
    if avatar:
        (AVATAR_DIR / avatar).unlink(missing_ok=True)
    user_id = user.id
    db.expire_all()
    db.delete(db.get(User, user_id))
    db.flush()
    # Başka üyesi kalmayan sahip olunan çalışma alanlarını da kaldır.
    for wid in owned_workspaces:
        if not db.scalar(select(WorkspaceMember.id).where(WorkspaceMember.workspace_id == wid).limit(1)):
            db.execute(delete(Workspace).where(Workspace.id == wid))
    db.commit()

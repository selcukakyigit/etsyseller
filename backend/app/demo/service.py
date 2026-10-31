"""Örnek mağaza: Etsy'yi henüz bağlamamış kullanıcı tek tıkla uydurma bir mağazayla ürünün tamamını deneyebilir (bkz. demo/seed.py).

Kurallar: çalışma alanında zaten gerçek bir mağaza varsa örnek açılmaz; çalışma alanı başına en çok bir örnek mağaza vardır; gerçek mağaza
bağlanınca örnek mağaza kendiliğinden silinir (iki mağaza karışmasın)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.account.danger import wipe_shops
from app.auth.models import User
from app.auth.workspaces import primary_workspace
from app.demo import seed
from app.demo.seed import REVIEWER_ID_BASE, SELF_SERVICE_ID_BASE
from app.shops.models import Shop


class SampleError(Exception):
    pass


def create_sample_shop(db: Session, user: User) -> Shop:
    ws = primary_workspace(db, user)
    shops = db.scalars(select(Shop).where(Shop.workspace_id == ws.id)).all()
    if any(not s.is_demo for s in shops):
        raise SampleError("Etsy mağazan zaten bağlı")
    existing = next((s for s in shops if s.is_demo), None)
    if existing is not None:
        return existing
    shop = Shop(
        user_id=user.id, workspace_id=ws.id, etsy_shop_id=-(SELF_SERVICE_ID_BASE + ws.id), etsy_user_id=-(SELF_SERVICE_ID_BASE + ws.id),
        shop_name=f"{seed.SHOP_NAME} (Sample)", is_demo=True,
    )
    db.add(shop)
    db.flush()
    seed.seed_shop(db, shop)
    db.refresh(shop)
    return shop


def remove_sample_shops(db: Session, workspace_id: int) -> int:
    """Çalışma alanındaki, kullanıcının KENDİ açtığı örnek mağazaları ve verilerini siler; silinen sayıyı döner. İncelemeci hesaplarının demo mağazasına
    (scripts/create_demo_account.py) dokunmaz: bir incelemeci kendi Etsy mağazasını bağlasa da demo bozulmasın."""
    ids = list(db.scalars(select(Shop.id).where(
        Shop.workspace_id == workspace_id, Shop.is_demo.is_(True), Shop.etsy_shop_id < 0, Shop.etsy_shop_id > -REVIEWER_ID_BASE,
    )))
    if ids:
        wipe_shops(db, ids)
    return len(ids)

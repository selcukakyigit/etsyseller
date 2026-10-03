"""Etsy bağlantısını kesme: erişim belirteçleri ve Etsy'den gelen önbellek verisi silinir.

Silinen: belirteçler, ilan/sipariş/yorum önbellekleri, finans defteri ve ödemeler, istatistik anlık görüntüleri, ilan sağlığı,
kargo referans önbelleği, sipariş bildirimleri ve diskteki ilan görselleri.
Kalan: mağaza kaydı (yeniden bağlanınca aynı mağaza gelir), kullanıcının kendi girdiği maliyetler, taslaklar ve sürüm geçmişi.
Etsy'nin belirteç iptal uç noktası yoktur; uygulama erişimini Etsy hesabındaki "Apps and services"ten de kaldırabilirsiniz."""
import shutil
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.db import Base
from app.listings import sync_status
from app.shops.models import OAuthToken, Shop

UPLOADS = Path(__file__).resolve().parents[2] / "uploads"
# Etsy'den gelen (yeniden çekilebilen) veriyi tutan tablolar; hepsinde shop_id vardır.
ETSY_DERIVED_TABLES = (
    "listing_cache", "order_cache", "review_cache", "ledger_entries", "fin_payments",
    "listing_stat_snapshots", "listing_health", "shipping_reference_cache", "rank_snapshots", "notifications",
)


def disconnect_shop(db: Session, shop: Shop) -> None:
    for name in ETSY_DERIVED_TABLES:
        table = Base.metadata.tables.get(name)
        if table is not None and "shop_id" in table.c:
            db.execute(delete(table).where(table.c.shop_id == shop.id))
    db.execute(delete(OAuthToken).where(OAuthToken.shop_id == shop.id))
    shop.listings_synced_at = None
    db.commit()
    db.expire(shop)

    sync_status.mark_done(shop.id)  # sürmekte olan senkron bayrağını temizle
    from app.finance import service as finance_service  # bellekteki rapor önbelleği

    finance_service._finance_cache.pop(shop.id, None)
    shutil.rmtree(UPLOADS / "image-cache" / str(shop.id), ignore_errors=True)

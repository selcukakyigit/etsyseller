"""İlanları Etsy ile periyodik doğrular (Etsy kuralı: ilan verisi en fazla 6 saat eski gösterilebilir).

Hafiftir: ilan listesini sayfa sayfa çeker (100 ilan = 1 istek); envanter/özellik gibi ağır çağrılar yalnızca Etsy'de
`last_modified_timestamp`'i değişen ilanlar için yapılır (bkz. listings.service.sync_listings)."""
import datetime as dt
import logging
import time

from app.core.db import SessionLocal
from app.etsy import rate_limit
from app.listings import service, sync_status
from app.shops.models import Shop

logger = logging.getLogger(__name__)

# Süreç sık yeniden başlasa da (deploy, bellek) Etsy'yi gereksiz yormamak için: bu süreden yeni doğrulanmışsa atla.
FRESH_ENOUGH = dt.timedelta(hours=3)


def refresh_all_shops() -> None:
    db = SessionLocal()
    try:
        for shop in db.query(Shop).all():
            if shop.oauth_token is None:
                continue
            if shop.listings_synced_at and dt.datetime.utcnow() - shop.listings_synced_at < FRESH_ENOUGH:
                continue
            if not rate_limit.background_budget_ok():
                logger.warning("Etsy günlük istek bütçesi doluyor (%s); ilan yenilemesi ertelendi", rate_limit.calls_today())
                return
            if not sync_status.mark_syncing(shop.id):
                continue  # zaten çalışıyor
            service._run_sync_in_background(shop.id)  # bitince mark_done çağırır
            time.sleep(5)  # mağazalar arasında kısa nefes
    except Exception:
        logger.exception("Zamanlanmış ilan yenilemesi başarısız")
    finally:
        db.close()

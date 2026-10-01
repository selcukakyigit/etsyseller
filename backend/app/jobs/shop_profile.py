import logging

from app.core.db import SessionLocal
from app.etsy import shop as etsy_shop
from app.etsy.client import EtsyAuthError, EtsyClient
from app.shops import reference_cache
from app.shops.models import Shop

logger = logging.getLogger(__name__)


def sync_all_shops() -> None:
    """Mağaza profilini (logo, duyuru, yorum ortalaması/sayısı, favori sayısı, tatil modu) günlük tazeler.
    Etsy'de bu alanlar bizim bir yazma işlemimiz olmadan da değişebiliyor (ör. yeni bir yorum geldiğinde
    review_average kendiliğinden değişir), bu yüzden reference_cache.invalidate yerine periyodik `set` kullanılır."""
    db = SessionLocal()
    try:
        for shop in db.query(Shop).all():
            if shop.oauth_token is None:
                continue
            try:
                client = EtsyClient(db, shop)
                data = etsy_shop.get_shop(client)
            except EtsyAuthError as exc:
                logger.warning("Skipping shop %s (auth error): %s", shop.id, exc)
                continue
            except Exception:
                logger.exception("Failed to fetch shop profile for shop %s", shop.id)
                continue

            icon = data.get("icon_url_fullxfull")
            if icon and icon != shop.icon_url:
                shop.icon_url = icon
                db.commit()

            reference_cache.set(db, shop, "shop_profile", data)
    finally:
        db.close()

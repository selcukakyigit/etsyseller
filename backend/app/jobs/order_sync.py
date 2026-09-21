import logging

from app.core.db import SessionLocal
from app.etsy.client import EtsyAuthError
from app.orders.service import sync_orders
from app.shops.models import Shop

logger = logging.getLogger(__name__)


def sync_all_shops() -> None:
    db = SessionLocal()
    try:
        shops = db.query(Shop).all()
        for shop in shops:
            if shop.oauth_token is None:
                continue
            try:
                sync_orders(db, shop)
            except EtsyAuthError as exc:
                logger.warning("Skipping shop %s (auth error): %s", shop.id, exc)
            except Exception:
                logger.exception("Failed to sync orders for shop %s", shop.id)
    finally:
        db.close()

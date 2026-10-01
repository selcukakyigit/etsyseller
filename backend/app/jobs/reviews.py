import datetime as dt
import logging

from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.etsy import shop as etsy_shop
from app.etsy.client import EtsyAuthError, EtsyClient
from app.shops.models import ReviewCache, Shop

logger = logging.getLogger(__name__)
PAGE_SIZE = 100


def sync_all_shops() -> None:
    """Mağaza yorumlarını artımlı senkronize eder (bkz. orders/service.py sync_orders ile aynı desen):
    yalnızca en son senkronizasyondan sonra oluşturulmuş yorumlar çekilir, tüm geçmiş her seferinde
    yeniden çekilmez."""
    db = SessionLocal()
    try:
        for shop in db.query(Shop).all():
            if shop.oauth_token is None:
                continue
            try:
                _sync_one(db, shop)
            except EtsyAuthError as exc:
                logger.warning("Skipping shop %s (auth error): %s", shop.id, exc)
            except Exception:
                logger.exception("Failed to sync reviews for shop %s", shop.id)
    finally:
        db.close()


def _sync_one(db, shop: Shop) -> None:
    client = EtsyClient(db, shop)
    last = db.execute(select(func.max(ReviewCache.created_at)).where(ReviewCache.shop_id == shop.id)).scalar()
    min_created = int(last.timestamp()) + 1 if last else None

    offset = 0
    added = 0
    while True:
        page = etsy_shop.list_shop_reviews(client, min_created=min_created, limit=PAGE_SIZE, offset=offset)
        results = page.get("results") or []
        for r in results:
            ts = r.get("create_timestamp") or r.get("created_timestamp")
            if not ts:
                continue
            row = db.get(ReviewCache, r["transaction_id"])
            if row is None:
                row = ReviewCache(transaction_id=r["transaction_id"], shop_id=shop.id)
                db.add(row)
            row.listing_id = r.get("listing_id")
            row.buyer_user_id = r.get("buyer_user_id")
            row.rating = r.get("rating") or 0
            row.review = r.get("review") or ""
            row.language = r.get("language")
            row.image_url = r.get("image_url_fullxfull")
            row.created_at = dt.datetime.utcfromtimestamp(ts)
            added += 1
        db.commit()
        offset += len(results)
        if offset >= page.get("count", 0) or not results:
            break
    if added:
        logger.info("Shop %s: %s yorum senkronize edildi (artımlı=%s)", shop.id, added, min_created is not None)

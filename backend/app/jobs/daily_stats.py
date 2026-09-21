import datetime as dt
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.etsy import listings as etsy_listings
from app.etsy.client import EtsyAuthError, EtsyClient
from app.listings.models import ListingStatSnapshot
from app.shops.models import Shop

logger = logging.getLogger(__name__)


def _already_captured_today(db: Session, shop_id: int, listing_id: int) -> bool:
    today_start = dt.datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    existing = db.scalars(
        select(ListingStatSnapshot)
        .where(ListingStatSnapshot.shop_id == shop_id)
        .where(ListingStatSnapshot.listing_id == listing_id)
        .where(ListingStatSnapshot.captured_at >= today_start)
        .limit(1)
    ).first()
    return existing is not None


def capture_daily_stats() -> None:
    """Snapshot views/favorites for every listing of every connected shop.
    Runs on its own DB session since it's not triggered by a request."""
    db = SessionLocal()
    try:
        shops = db.query(Shop).all()
        for shop in shops:
            if shop.oauth_token is None:
                continue
            try:
                client = EtsyClient(db, shop)
                listings = etsy_listings.list_active_listings(client)
            except EtsyAuthError as exc:
                logger.warning("Skipping shop %s (auth error): %s", shop.id, exc)
                continue
            except Exception:
                logger.exception("Failed to fetch listings for shop %s during daily stats capture", shop.id)
                continue

            for item in listings:
                if _already_captured_today(db, shop.id, item["listing_id"]):
                    continue
                db.add(
                    ListingStatSnapshot(
                        shop_id=shop.id,
                        listing_id=item["listing_id"],
                        views=item.get("views") or 0,
                        favorites=item.get("num_favorers") or 0,
                    )
                )
            db.commit()
    finally:
        db.close()

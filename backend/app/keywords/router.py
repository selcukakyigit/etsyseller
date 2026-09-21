from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.etsy import listings as etsy_listings
from app.etsy.client import EtsyAuthError, EtsyClient
from app.keywords import service, trends
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/listings/{listing_id}/keyword-pool", tags=["keywords"])

# Google Trends is rate-limited and slow (multiple sequential batched
# requests) — trends are only looked up for the top of the pool, not fetched
# automatically with the main pool.
TRENDS_LIMIT = 15


@router.get("")
def keyword_pool(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        listing = etsy_listings.get_listing(client, listing_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    return {"keywords": service.build_keyword_pool(db, shop, listing)}


@router.get("/trends")
def keyword_trends(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Separate, on-demand Google Trends lookup for the current keyword pool —
    kept apart from the main pool endpoint since it's slow and rate-limited,
    and it's Google web-search demand, not Etsy on-site search demand."""
    try:
        client = EtsyClient(db, shop)
        listing = etsy_listings.get_listing(client, listing_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc

    pool = service.build_keyword_pool(db, shop, listing)
    top_keywords = [item["tag"] for item in pool[:TRENDS_LIMIT]]
    scores = trends.get_trend_scores(db, top_keywords)

    return {
        "keywords": [
            {**item, "google_score": scores[item["tag"]]} for item in pool[:TRENDS_LIMIT] if item["tag"] in scores
        ]
    }

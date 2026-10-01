import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.etsy.client import EtsyAuthError, EtsyClient
from app.keywords import service, trends
from app.listings import service as listings_service
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/listings/{listing_id}/keyword-pool", tags=["keywords"])

# Google Trends is rate-limited and slow (multiple sequential batched
# requests) — trends are only looked up for the top of the pool, not fetched
# automatically with the main pool.
TRENDS_LIMIT = 15


def _local_listing(db: Session, shop: Shop, listing_id: int) -> dict:
    """Havuz yalnızca title/tags/taxonomy_id'ye ihtiyaç duyar — bunlar zaten yerel önbellekte (ListingCache);
    her panel açılışında Etsy'ye ayrı bir get_listing isteği atmanın anlamı yok (günlük kota Personal Access'te
    5000 istekle sınırlı). Yalnızca önbellekte hiç yoksa (ör. daha yeni oluşturulmuş bir listing) Etsy'den çekilir."""
    row = listings_service._get_cache_row(db, shop, listing_id)
    if row is None:
        try:
            row = listings_service._fetch_and_cache_one(db, shop, EtsyClient(db, shop), listing_id)
        except EtsyAuthError as exc:
            raise HTTPException(401, str(exc)) from exc
    return json.loads(row.raw_json)


@router.get("")
def keyword_pool(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    listing = _local_listing(db, shop, listing_id)
    return {"keywords": service.build_keyword_pool(db, shop, listing)}


@router.get("/trends")
def keyword_trends(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Separate, on-demand Google Trends lookup for the current keyword pool —
    kept apart from the main pool endpoint since it's slow and rate-limited,
    and it's Google web-search demand, not Etsy on-site search demand."""
    listing = _local_listing(db, shop, listing_id)
    pool = service.build_keyword_pool(db, shop, listing)
    # Havuzun başı yalnızca kendi etiketlerinle dolmasın: yarısı kendi, yarısı rakip etiketlerinden.
    own = [i for i in pool if i["source"] == "own"][: TRENDS_LIMIT // 2 + 1]
    comp = [i for i in pool if i["source"] != "own"][: TRENDS_LIMIT - len(own)]
    top_keywords = [item["tag"] for item in own + comp]
    scores = trends.get_trend_scores(db, top_keywords)

    return {
        "keywords": [
            {**item, "google_score": scores[item["tag"]]} for item in pool[:TRENDS_LIMIT] if item["tag"] in scores
        ]
    }

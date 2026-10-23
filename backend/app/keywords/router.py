import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.etsy.client import EtsyAuthError, EtsyClient
from app.keywords import service
from app.listings import service as listings_service
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/listings/{listing_id}/keyword-pool", tags=["keywords"])

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
    return {"keywords": service.public_pool(service.scored_pool(db, shop, listing))}  # yapay zekânın kullandığı AYNI puanlı havuz; ham araştırma sayıları çıkarılmış

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.insights import diagnosis
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/insights", tags=["insights"])


@router.get("/listings/{listing_id}/diagnosis")
def listing_diagnosis(listing_id: int, today: dt.date | None = None, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Bir listing'in satış teşhisi: durum, sebep, kanıtlar, önerilen hamle, mevsim ve aylık satış serisi."""
    d = diagnosis.diagnose(db, shop, listing_id, today)
    if d is None:
        raise HTTPException(404, "Listing bulunamadı")
    return d

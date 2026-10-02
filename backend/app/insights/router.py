import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.etsy.client import EtsyApiError
from app.insights import diagnosis, rank
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


class KeywordIn(BaseModel):
    keyword: str = Field(min_length=1, max_length=rank.KEYWORD_MAX_LEN)


@router.get("/listings/{listing_id}/ranks")
def listing_ranks(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Takip edilen aramalar: son sıra, 7/30 günlük değişim, rakip sayısı, fiyat kıyası ve 60 günlük geçmiş."""
    return rank.listing_ranks(db, shop, listing_id)


@router.post("/listings/{listing_id}/keywords")
def add_keyword(listing_id: int, payload: KeywordIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        rank.add_keyword(db, shop, listing_id, payload.keyword)
    except rank.RankError as exc:
        raise HTTPException(400, str(exc)) from exc
    return rank.listing_ranks(db, shop, listing_id)


@router.delete("/listings/{listing_id}/keywords")
def remove_keyword(listing_id: int, keyword: str, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    rank.remove_keyword(db, shop, listing_id, keyword)
    return rank.listing_ranks(db, shop, listing_id)


@router.delete("/listings/{listing_id}/tracking")
def stop_tracking(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    rank.stop_listing(db, shop, listing_id)
    return rank.listing_ranks(db, shop, listing_id)


@router.post("/listings/{listing_id}/ranks/measure")
def measure_now(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Takip edilen aramaları hemen ölçer (yeni eklenen arama için ertesi günü beklemeden)."""
    try:
        rank.measure_listing(db, shop, listing_id)
    except rank.RankError as exc:
        raise HTTPException(400, str(exc)) from exc
    except EtsyApiError as exc:
        raise HTTPException(502, str(exc)) from exc
    return rank.listing_ranks(db, shop, listing_id)

import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.uploads import read_limited
from app.etsy.client import EtsyApiError
from app.insights import diagnosis, etsy_data, impact, rank
from app.shops.deps import get_owned_shop, require_ai_enabled
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/insights", tags=["insights"])


@router.get("/attention")
def attention(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Düşüşteki listing'ler: en çok satış kaybeden 5'inin teşhisi ve "Düşüşte" filtresi için tüm kimlikler."""
    return diagnosis.attention(db, shop)


@router.get("/faded")
def faded(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Sönmüş listing'ler: eskiden satan ama 90 gündür satmayanlar (liste rozeti ve "Sönmüş" filtresi için)."""
    return diagnosis.faded(db, shop)


@router.get("/changes")
def changes_summary(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Son 90 günde yayınlanan değişikliklerin sonuç dağılımı (iyileşti/değişmedi/kötüleşti/bekliyor) ve en yenileri."""
    return impact.shop_summary(db, shop)


@router.get("/listings/{listing_id}/diagnosis")
def listing_diagnosis(listing_id: int, today: dt.date | None = None, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Bir listing'in satış teşhisi: durum, sebep, kanıtlar, önerilen hamle, mevsim ve aylık satış serisi."""
    d = diagnosis.diagnose(db, shop, listing_id, today)
    if d is None:
        raise HTTPException(404, "Listing bulunamadı")
    return d


class KeywordIn(BaseModel):
    keyword: str = Field(min_length=1, max_length=rank.KEYWORD_MAX_LEN)


@router.get("/ranks")
def ranks_summary(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Takipteki listing'ler: her birinin en iyi aramadaki sırası ve 7 günlük değişimi (liste rozeti ve filtresi için)."""
    return rank.shop_summary(db, shop)


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


# ------------------------------------------------------------------ Etsy verisi (yapıştırılan)

class EtsyDataRow(BaseModel):
    keyword: str = Field(min_length=1, max_length=100)
    searches: int | None = None
    competition: str | None = None
    conversion: str | None = None
    trend_pct: int | None = None
    listings_count: int | None = None
    views: int | None = None
    clicks: int | None = None
    orders: int | None = None


class EtsyDataIn(BaseModel):
    listing_id: int | None = None
    source: str
    period_start: str | None = None
    period_end: str | None = None
    rows: list[EtsyDataRow] = Field(min_length=1, max_length=etsy_data.MAX_ROWS)


class IdsIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)


@router.post("/etsy-data/parse", dependencies=[Depends(require_ai_enabled)])
async def parse_etsy_data(text: str | None = Form(default=None), file: UploadFile | None = File(default=None), shop: Shop = Depends(get_owned_shop)):
    """Yapıştırılan tabloyu ya da ekran görüntüsünü okur; KAYDETMEZ (onay ekranı için)."""
    image = None
    if file is not None:
        if not (file.content_type or "").startswith("image/"):
            raise HTTPException(400, "Yalnızca ekran görüntüsü (resim) yüklenebilir")
        image = (await read_limited(file, 15 * 1024 * 1024, "Resim"), file.content_type or "image/png")
    try:
        return etsy_data.parse(text, image)
    except etsy_data.EtsyDataError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/etsy-data")
def save_etsy_data(payload: EtsyDataIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        return etsy_data.save(db, shop, payload.listing_id, payload.source, [r.model_dump() for r in payload.rows], payload.period_start, payload.period_end)
    except etsy_data.EtsyDataError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/listings/{listing_id}/etsy-data")
def listing_etsy_data(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return {"rows": etsy_data.for_listing(db, shop, listing_id), "to_check": etsy_data.to_check(db, shop)}


@router.post("/etsy-data/delete")
def delete_etsy_data(payload: IdsIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return {"deleted": etsy_data.delete(db, shop, payload.ids)}

import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.notifications import service, summary
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/notifications", tags=["notifications"])


@router.get("")
def list_notifications(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.list_for_shop(db, shop)


@router.post("/read")
def mark_read(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    service.mark_all_read(db, shop)
    return {"ok": True}


@router.get("/summary")
def summary_strip(today: dt.date | None = None, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Üst çubuğun altındaki özet şeridi (bugün gönderilecek, bugünün satışı, ayın en çok satanı). `today`: istemcinin yerel tarihi."""
    return summary.summary(db, shop, today or dt.date.today())

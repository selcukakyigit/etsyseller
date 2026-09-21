import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.etsy.client import EtsyAuthError
from app.orders import service
from app.orders.schemas import OrderInsightsOut, OrderOut, OrdersPageOut, OrdersSyncStatus, ShipRequest
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/orders", tags=["orders"])


@router.get("", response_model=list[OrderOut])
def get_orders(
    needs_shipping: bool = Query(default=False),
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    return service.list_orders(db, shop, needs_shipping=needs_shipping or None)


@router.get("/page", response_model=OrdersPageOut)
def orders_page(
    tab: str = "toship",
    q: str = "",
    ship_by: str = "all",
    destination: str = "",
    channel: str = "all",
    note: bool = False,
    gift: bool = False,
    personalized: bool = False,
    upgrade: bool = False,
    sort: str = "shipby",
    page: int = Query(default=0, ge=0),
    per_page: int = Query(default=50, ge=1, le=200),
    today: dt.date | None = None,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    """Filtrelenmiş + sayfalanmış siparişler. `today`: istemcinin yerel tarihi (gönderim tarihi kovaları için)."""
    return service.orders_page(
        db, shop, tab=tab, q=q, ship_by=ship_by, destination=destination, channel=channel, note=note, gift=gift,
        personalized=personalized, upgrade=upgrade, sort=sort, page=page, per_page=per_page, today=today,
    )


@router.get("/sync-status", response_model=OrdersSyncStatus)
def sync_status(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.sync_status(db, shop)


@router.post("/sync", response_model=OrdersSyncStatus)
def sync(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        service.sync_orders(db, shop)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    return service.sync_status(db, shop)


@router.get("/insights", response_model=OrderInsightsOut)
def insights(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.get_insights(db, shop)


@router.post("/{receipt_id}/ship", response_model=OrderOut)
def ship(
    receipt_id: int,
    payload: ShipRequest,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        return service.mark_shipped(db, shop, receipt_id, payload.tracking_code, payload.carrier_name)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    except service.OrderNotFound as exc:
        raise HTTPException(404, str(exc)) from exc

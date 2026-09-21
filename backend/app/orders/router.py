from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.etsy.client import EtsyAuthError
from app.orders import service
from app.orders.schemas import OrderInsightsOut, OrderOut, ShipRequest
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


@router.post("/sync", response_model=list[OrderOut])
def sync(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        service.sync_orders(db, shop)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    return service.list_orders(db, shop)


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

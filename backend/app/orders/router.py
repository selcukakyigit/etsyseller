import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.i18n import tr
from app.etsy.client import EtsyApiError, EtsyAuthError
from app.orders import service
from app.orders.schemas import MoveIn, OrderInsightsOut, OrderOut, OrdersPageOut, OrdersSyncStatus, ShipRequest, StepOut, StepsIn
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


@router.get("/steps", response_model=list[StepOut])
def get_steps(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return [StepOut(id=s.id, name=s.name) for s in service.list_steps(db, shop)]


@router.put("/steps", response_model=list[StepOut])
def save_steps(payload: StepsIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """İlerleme adımlarının tamamını verilen sırayla kaydeder (yeniden adlandırma, sıralama, ekleme, silme tek çağrıda)."""
    try:
        steps = service.save_steps(db, shop, [(s.id, s.name) for s in payload.steps])
    except service.StepError as exc:
        raise HTTPException(400, str(exc)) from exc
    return [StepOut(id=s.id, name=s.name) for s in steps]


@router.post("/move")
def move(payload: MoveIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Seçili açık siparişleri bir ilerleme adımına (ya da step_id boşsa New'e) taşır."""
    try:
        return {"moved": service.move_orders(db, shop, payload.receipt_ids, payload.step_id)}
    except service.StepError as exc:
        raise HTTPException(400, str(exc)) from exc


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
    except EtsyApiError as exc:
        if exc.status_code == 403:  # createReceiptShipment yalnızca Etsy'nin onayladığı uygulamalara açıktır (Commercial Access tek başına yetmez)
            raise HTTPException(403, tr(
                "Etsy bu uygulamaya 'gönderildi olarak işaretleme' (createReceiptShipment) izni vermemiş; Etsy kısıtlı bir uç nokta olarak sunuyor. Siparişi Etsy'de tamamla; uygulama için izin istemek üzere developers@etsy.com'a yazılabilir.",
                "Etsy has not approved this app for marking orders as shipped (createReceiptShipment is a restricted endpoint). Complete the order on Etsy; you can ask developers@etsy.com about approval for this app.",
            )) from exc
        raise
    except service.OrderNotFound as exc:
        raise HTTPException(404, str(exc)) from exc

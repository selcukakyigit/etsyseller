import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.finance import export, service
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/finance", tags=["finance"])


class CostIn(BaseModel):
    unit_cost: float = Field(ge=0, le=1_000_000)
    shipping_cost: float = Field(ge=0, le=1_000_000)
    cost_pct: float = Field(default=0, ge=0, le=1000)
    fix_past: bool = False  # True: geçmiş siparişleri de yeni maliyetle hesapla


class VariantCostIn(CostIn):
    key: str = Field(max_length=300)


class OrderCostIn(BaseModel):
    cost: float | None = Field(default=None, ge=0, le=10_000_000)  # None = elle girilmiş maliyeti sil
    note: str = Field(default="", max_length=255)


@router.get("/report")
def report(
    start: dt.date,
    end: dt.date,
    country: str = "",
    compare: str = "1",
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    offsets = [int(x) for x in compare.split(",") if x.strip().isdigit()]
    return service.report(db, shop, start, end, country, compare=offsets)


@router.get("/sync-status")
def sync_status(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.sync_status(db, shop)


@router.post("/sync")
def sync(full: bool = False, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    service.start_sync(shop, full=full)
    return service.sync_status(db, shop)


@router.put("/costs/{listing_id}")
def put_cost(listing_id: int, body: CostIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    service.set_cost(db, shop, listing_id, body.unit_cost, body.shipping_cost, body.cost_pct, body.fix_past)
    return {"ok": True}


@router.put("/costs/{listing_id}/variant")
def put_variant_cost(listing_id: int, body: VariantCostIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    service.set_variant_cost(db, shop, listing_id, body.key, body.unit_cost, body.shipping_cost, body.cost_pct, body.fix_past)
    return {"ok": True}


@router.delete("/costs/{listing_id}/variant")
def delete_variant_cost(listing_id: int, key: str, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    service.clear_variant_cost(db, shop, listing_id, key)
    return {"ok": True}


@router.get("/orders")
def orders_costs(
    start: dt.date,
    end: dt.date,
    q: str = "",
    page: int = 0,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    return service.orders_costs(db, shop, start, end, q, max(0, page))


@router.get("/orders/{receipt_id}")
def order_detail(receipt_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    data = service.order_detail(db, shop, receipt_id)
    if data is None:
        raise HTTPException(404, "Sipariş bulunamadı")
    return data


@router.put("/orders/{receipt_id}/cost")
def put_order_cost(receipt_id: int, body: OrderCostIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    service.set_order_cost(db, shop, receipt_id, body.cost, body.note)
    return {"ok": True}


@router.get("/export.xlsx")
def export_xlsx(
    start: dt.date,
    end: dt.date,
    country: str = "",
    scope: str = "all",
    q: str = "",
    sort: str = "sales",
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    if scope not in {"all", "overview", "products", "orders"}:
        scope = "all"
    data = export.build_xlsx(db, shop, start, end, country, scope, q, sort)
    name = f"finans_{scope}_{start}_{end}.xlsx"
    return Response(
        data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )

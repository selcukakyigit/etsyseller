"""Üst çubuğun altındaki özet şeridi: bugünün siparişleri, gönderilecek/geciken sayısı, ayın en çok satan ürünü.
Sayılar siparişlerin yerel kopyasından gelir; Etsy'ye istek atılmaz."""
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.finance import service as fin
from app.orders.models import OrderCache
from app.shops.models import Shop


def order_snapshot(db: Session, shop: Shop, today: dt.date) -> dict:
    """Gönderilecek (ödenmiş, gönderilmemiş, iptal olmamış), geciken ve bugün gelen siparişler (adet ve tutar)."""
    day_start = dt.datetime.combine(today, dt.time.min)
    open_orders = (OrderCache.shop_id == shop.id, OrderCache.is_paid.is_(True), OrderCache.is_shipped.is_(False), OrderCache.is_canceled.is_(False))
    to_ship = db.scalar(select(func.count()).select_from(OrderCache).where(*open_orders)) or 0
    overdue = db.scalar(select(func.count()).select_from(OrderCache).where(*open_orders, OrderCache.expected_ship_date < day_start)) or 0
    orders, sales = db.execute(
        select(func.count(), func.coalesce(func.sum(OrderCache.grandtotal_amount / OrderCache.grandtotal_divisor), 0.0)).where(
            OrderCache.shop_id == shop.id, OrderCache.created_at >= day_start, OrderCache.is_canceled.is_(False)
        )
    ).one()
    return {"to_ship": to_ship, "overdue": overdue, "today": {"orders": orders, "sales": round(float(sales), 2)}}


def summary(db: Session, shop: Shop, today: dt.date) -> dict:
    """Şerit verisi: order_snapshot + ayın satışı (geçen ayın aynı dönemiyle) ve en çok satan ürün. Finans raporu panodakiyle aynı
    parametrelerle istendiği için ortak önbellekten gelir."""
    month_start = today.replace(day=1)
    r = fin.report(db, shop, month_start, today, compare=[1])
    products = sorted(r["products"], key=lambda p: (-p["units"], -p["sales"]))
    top = products[0] if products and products[0]["units"] > 0 else None
    return {
        **order_snapshot(db, shop, today),
        "currency": r["currency"],
        "month": {"sales": round(r["kpi"]["sales"], 2), "prev_sales": round(r["prev_kpi"]["sales"], 2)},
        "top_product": {"listing_id": top["listing_id"], "title": top["title"], "units": top["units"]} if top else None,
    }

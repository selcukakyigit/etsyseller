import datetime as dt
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.client import get_openai_client
from app.core.config import settings
from app.etsy import orders as etsy_orders
from app.etsy.client import EtsyClient
from app.orders.models import OrderCache
from app.orders.schemas import OrderInsightsOut, OrderItemOut, OrderOut
from app.shops.models import Shop


class OrderNotFound(Exception):
    pass


def _min_expected_ship_date(receipt: dict) -> dt.datetime | None:
    dates = [t["expected_ship_date"] for t in receipt.get("transactions", []) if t.get("expected_ship_date")]
    return dt.datetime.utcfromtimestamp(min(dates)) if dates else None


def sync_orders(db: Session, shop: Shop, limit: int = 100) -> int:
    client = EtsyClient(db, shop)
    receipts = etsy_orders.list_receipts(client, limit=limit)

    synced = 0
    for receipt in receipts:
        row = db.scalars(
            select(OrderCache)
            .where(OrderCache.shop_id == shop.id)
            .where(OrderCache.receipt_id == receipt["receipt_id"])
        ).one_or_none()
        if row is None:
            row = OrderCache(shop_id=shop.id, receipt_id=receipt["receipt_id"])
            db.add(row)

        row.status = receipt["status"]
        row.buyer_name = receipt.get("name") or ""
        row.grandtotal_amount = receipt["grandtotal"]["amount"]
        row.grandtotal_divisor = receipt["grandtotal"]["divisor"]
        row.currency_code = receipt["grandtotal"]["currency_code"]
        row.is_paid = receipt["is_paid"]
        row.is_shipped = receipt["is_shipped"]
        row.created_at = dt.datetime.utcfromtimestamp(receipt["created_timestamp"])
        row.expected_ship_date = _min_expected_ship_date(receipt)
        row.raw_json = json.dumps(receipt, ensure_ascii=False)
        row.synced_at = dt.datetime.utcnow()
        synced += 1

    db.commit()
    return synced


def _serialize_order(row: OrderCache) -> OrderOut:
    receipt = json.loads(row.raw_json)
    items = [
        OrderItemOut(listing_id=t.get("listing_id"), title=t.get("title", ""), quantity=t.get("quantity", 1))
        for t in receipt.get("transactions", [])
    ]
    tracking_codes = [
        s["tracking_code"] for s in receipt.get("shipments", []) if s.get("tracking_code")
    ]
    total = f"{row.grandtotal_amount / row.grandtotal_divisor:.2f} {row.currency_code}"

    return OrderOut(
        receipt_id=row.receipt_id,
        status=row.status,
        buyer_name=row.buyer_name,
        total=total,
        is_paid=row.is_paid,
        is_shipped=row.is_shipped,
        created_at=row.created_at.isoformat(),
        expected_ship_date=row.expected_ship_date.isoformat() if row.expected_ship_date else None,
        items=items,
        tracking_codes=tracking_codes,
    )


def list_orders(db: Session, shop: Shop, needs_shipping: bool | None = None) -> list[OrderOut]:
    query = select(OrderCache).where(OrderCache.shop_id == shop.id)
    if needs_shipping:
        query = query.where(OrderCache.is_paid.is_(True)).where(OrderCache.is_shipped.is_(False))
    query = query.order_by(OrderCache.created_at.desc())
    rows = db.scalars(query).all()
    return [_serialize_order(row) for row in rows]


def mark_shipped(db: Session, shop: Shop, receipt_id: int, tracking_code: str | None, carrier_name: str | None) -> OrderOut:
    row = db.scalars(
        select(OrderCache).where(OrderCache.shop_id == shop.id).where(OrderCache.receipt_id == receipt_id)
    ).one_or_none()
    if row is None:
        raise OrderNotFound("Sipariş bulunamadı — önce senkronize edin.")

    client = EtsyClient(db, shop)
    data = {}
    if tracking_code:
        data["tracking_code"] = tracking_code
    if carrier_name:
        data["carrier_name"] = carrier_name
    receipt = etsy_orders.create_shipment(client, receipt_id, data)

    row.is_shipped = receipt["is_shipped"]
    row.status = receipt["status"]
    row.raw_json = json.dumps(receipt, ensure_ascii=False)
    row.synced_at = dt.datetime.utcnow()
    db.commit()
    return _serialize_order(row)


def get_insights(db: Session, shop: Shop) -> OrderInsightsOut:
    rows = db.scalars(
        select(OrderCache)
        .where(OrderCache.shop_id == shop.id)
        .where(OrderCache.is_paid.is_(True))
        .where(OrderCache.is_shipped.is_(False))
    ).all()

    today = dt.datetime.utcnow().date()
    needs_shipping_today = sum(1 for r in rows if r.expected_ship_date and r.expected_ship_date.date() <= today)
    overdue = sum(1 for r in rows if r.expected_ship_date and r.expected_ship_date.date() < today)

    week_ago = dt.datetime.utcnow() - dt.timedelta(days=7)
    recent_rows = db.scalars(
        select(OrderCache).where(OrderCache.shop_id == shop.id).where(OrderCache.created_at >= week_ago)
    ).all()
    title_counts: dict[str, int] = {}
    for r in recent_rows:
        receipt = json.loads(r.raw_json)
        for t in receipt.get("transactions", []):
            title = t.get("title", "")
            title_counts[title] = title_counts.get(title, 0) + t.get("quantity", 1)
    top_listing = max(title_counts, key=title_counts.get) if title_counts else None

    summary = _generate_summary(needs_shipping_today, overdue, top_listing, len(recent_rows))

    return OrderInsightsOut(
        needs_shipping_today=needs_shipping_today,
        overdue=overdue,
        top_listing_last_7_days=top_listing,
        summary=summary,
    )


def _generate_summary(needs_shipping_today: int, overdue: int, top_listing: str | None, orders_last_7_days: int) -> str:
    if not settings.openai_api_key:
        return _fallback_summary(needs_shipping_today, overdue, top_listing, orders_last_7_days)

    prompt = (
        f"Bugün kargoya verilmesi gereken sipariş sayısı: {needs_shipping_today}\n"
        f"Süresi geçmiş (gecikmiş) sipariş sayısı: {overdue}\n"
        f"Son 7 günde en çok satan ürün: {top_listing or 'veri yok'}\n"
        f"Son 7 gündeki toplam sipariş sayısı: {orders_last_7_days}\n\n"
        "Bu verilerden, Etsy satıcısına yönelik 2 cümlelik, aksiyona yönlendiren, Türkçe bir günlük özet yaz. "
        "Sadece verilen sayılara dayan, uydurma."
    )
    try:
        completion = get_openai_client().chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=150,
        )
        return completion.choices[0].message.content or _fallback_summary(
            needs_shipping_today, overdue, top_listing, orders_last_7_days
        )
    except Exception:
        return _fallback_summary(needs_shipping_today, overdue, top_listing, orders_last_7_days)


def _fallback_summary(needs_shipping_today: int, overdue: int, top_listing: str | None, orders_last_7_days: int) -> str:
    parts = [f"Bugün {needs_shipping_today} sipariş kargoya verilmeyi bekliyor."]
    if overdue:
        parts.append(f"{overdue} sipariş gecikmiş, önceliklendir.")
    if top_listing:
        parts.append(f"Son 7 günde en çok satan: {top_listing}.")
    return " ".join(parts)

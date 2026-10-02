import datetime as dt
import html
import json
import logging
import threading

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.etsy import orders as etsy_orders
from app.etsy.client import EtsyClient
from app.listings.models import ListingCache
from app.orders.derive import derive
from app.orders.models import OrderCache
from app.orders.schemas import (
    AddressOut,
    DestinationCount,
    OrderCounts,
    OrderInsightsOut,
    OrderItemOut,
    OrderOut,
    OrdersPageOut,
    OrdersSyncStatus,
    OrderVariationOut,
    ShipmentOut,
)
from app.shops.models import Shop


class OrderNotFound(Exception):
    pass


def _min_expected_ship_date(receipt: dict) -> dt.datetime | None:
    dates = [t["expected_ship_date"] for t in receipt.get("transactions", []) if t.get("expected_ship_date")]
    return dt.datetime.utcfromtimestamp(min(dates)) if dates else None


# Alıcı e-postası saklanmaz: buyer_email için Etsy'den ayrı izin istemiyoruz (Commercial Access şartı) ve gerekmiyor.
_DROPPED_RECEIPT_FIELDS = ("buyer_email", "payment_email")


def _receipt_json(receipt: dict) -> str:
    return json.dumps({k: v for k, v in receipt.items() if k not in _DROPPED_RECEIPT_FIELDS}, ensure_ascii=False)


def _upsert(db: Session, shop: Shop, receipt: dict) -> None:
    row = db.scalars(
        select(OrderCache).where(OrderCache.shop_id == shop.id).where(OrderCache.receipt_id == receipt["receipt_id"])
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
    row.raw_json = _receipt_json(receipt)
    row.synced_at = dt.datetime.utcnow()
    for k, v in derive(receipt).items():
        setattr(row, k, v)


_backfill_state: dict[int, dict] = {}


def sync_status(db: Session, shop: Shop) -> OrdersSyncStatus:
    state = _backfill_state.get(shop.id, {})
    local = db.scalar(select(func.count()).select_from(OrderCache).where(OrderCache.shop_id == shop.id)) or 0
    return OrdersSyncStatus(local=local, remote_total=state.get("total"), backfilling=bool(state.get("running")))


def _backfill(shop_id: int) -> None:
    """Geçmiş siparişlerin tamamını arka planda indirir (sayfa sayfa; her sayfada kaydeder)."""
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        shop = db.get(Shop, shop_id)
        client = EtsyClient(db, shop)
        offset = 0
        while True:
            page = client.request(
                "GET",
                f"/shops/{shop.etsy_shop_id}/receipts",
                params={"limit": 100, "offset": offset, "sort_on": "created", "sort_order": "desc"},
            )
            for receipt in page["results"]:
                _upsert(db, shop, receipt)
            db.commit()
            offset += len(page["results"])
            _backfill_state[shop_id]["total"] = page["count"]
            if not page["results"] or offset >= page["count"]:
                break
    except Exception:
        logging.getLogger(__name__).exception("Order backfill failed for shop %s", shop_id)
    finally:
        _backfill_state[shop_id]["running"] = False
        db.close()


def sync_orders(db: Session, shop: Shop, limit: int = 200, full: bool = False) -> int:
    """Artımlı senkronizasyon: yalnızca son senkronizasyondan (1 gün pay ile) sonra DEĞİŞEN siparişler ve hâlâ
    gönderilmemiş olanlar çekilir. İlk kullanımda (yerel boş) ya da `full=True` ise son N sipariş alınır. Yerelde
    Etsy'den az sipariş varsa geri kalan geçmiş arka plan iş parçacığında bir kez indirilir."""
    client = EtsyClient(db, shop)
    last = None if full else db.scalar(select(func.max(OrderCache.synced_at)).where(OrderCache.shop_id == shop.id))
    if last is None:
        receipts = etsy_orders.list_receipts(client, limit=limit)
    else:
        since = int((last - dt.timedelta(days=1)).replace(tzinfo=dt.timezone.utc).timestamp())
        receipts = etsy_orders.list_receipts(client, limit=2000, extra_params={"min_last_modified": since})
    seen = {r["receipt_id"] for r in receipts}
    for r in etsy_orders.list_receipts(client, limit=500, extra_params={"was_shipped": "false", "was_canceled": "false"}):
        if r["receipt_id"] not in seen:
            receipts.append(r)
            seen.add(r["receipt_id"])
    for receipt in receipts:
        _upsert(db, shop, receipt)
    db.commit()
    logging.getLogger(__name__).info("Order sync: %s sipariş çekildi (artımlı=%s)", len(receipts), last is not None)

    total = etsy_orders.count_receipts(client)
    local = db.scalar(select(func.count()).select_from(OrderCache).where(OrderCache.shop_id == shop.id)) or 0
    state = _backfill_state.setdefault(shop.id, {"running": False, "total": total})
    state["total"] = total
    if local < total and not state["running"]:
        state["running"] = True
        threading.Thread(target=_backfill, args=(shop.id,), daemon=True).start()
    return len(receipts)


def _money(m: dict | None) -> str | None:
    if not m or not m.get("divisor"):
        return None
    return f"{m['amount'] / m['divisor']:.2f} {m.get('currency_code', '')}".strip()


def _listing_images(db: Session, shop: Shop, listing_ids: set[int]) -> dict[int, str]:
    """Sipariş kalemlerindeki listing'lerin küçük resimleri (yerel önbellekten; Etsy'ye istek yok)."""
    if not listing_ids:
        return {}
    out: dict[int, str] = {}
    for lid, raw in db.execute(
        select(ListingCache.listing_id, ListingCache.raw_json)
        .where(ListingCache.shop_id == shop.id)
        .where(ListingCache.listing_id.in_(listing_ids))
    ):
        images = json.loads(raw).get("images") or []
        if images:
            out[lid] = images[0].get("url_170x135") or images[0].get("url_75x75") or ""
    return out


def _serialize_order(row: OrderCache, images: dict[int, str] | None = None) -> OrderOut:
    receipt = json.loads(row.raw_json)
    images = images or {}
    items: list[OrderItemOut] = []
    personalized = False
    for t in receipt.get("transactions", []):
        variations = []
        for v in t.get("variations") or []:
            is_pers = (v.get("formatted_name") or "").strip().lower() == "personalization" or bool(v.get("question_id"))
            personalized = personalized or is_pers
            variations.append(
                OrderVariationOut(
                    name=html.unescape(v.get("formatted_name") or ""),
                    value=html.unescape(v.get("formatted_value") or ""),
                    personalization=is_pers,
                )
            )
        items.append(
            OrderItemOut(
                listing_id=t.get("listing_id"),
                title=html.unescape(t.get("title", "")),
                quantity=t.get("quantity", 1),
                sku=t.get("sku") or None,
                price=_money(t.get("price")),
                image_url=images.get(t.get("listing_id") or 0) or None,
                variations=variations,
            )
        )
    shipments = [
        ShipmentOut(
            carrier=s.get("carrier_name"),
            tracking_code=s.get("tracking_code"),
            notified_at=dt.datetime.utcfromtimestamp(s["shipment_notification_timestamp"]).isoformat()
            if s.get("shipment_notification_timestamp")
            else None,
        )
        for s in receipt.get("shipments", [])
    ]
    tracking_codes = [s["tracking_code"] for s in receipt.get("shipments", []) if s.get("tracking_code")]
    total = f"{row.grandtotal_amount / row.grandtotal_divisor:.2f} {row.currency_code}"
    first_t = (receipt.get("transactions") or [{}])[0]
    discount = receipt.get("discount_amt")
    coupon = _money(discount) if discount and discount.get("amount") else None
    if coupon is None and any(t.get("shop_coupon") or t.get("buyer_coupon") for t in receipt.get("transactions", [])):
        amount = sum((t.get("shop_coupon") or 0) + (t.get("buyer_coupon") or 0) for t in receipt.get("transactions", []))
        coupon = f"{amount:.2f} {row.currency_code}"

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
        channel="pattern" if receipt.get("receipt_type") == 1 else "etsy",
        address=AddressOut(
            name=receipt.get("name") or "",
            first_line=receipt.get("first_line") or "",
            second_line=receipt.get("second_line") or "",
            city=receipt.get("city") or "",
            state=receipt.get("state") or "",
            zip=receipt.get("zip") or "",
            country_iso=receipt.get("country_iso") or "",
            formatted=receipt.get("formatted_address") or "",
        ),
        buyer_note=html.unescape(receipt["message_from_buyer"]) if receipt.get("message_from_buyer") else None,
        is_gift=bool(receipt.get("is_gift")),
        gift_message=html.unescape(receipt["gift_message"]) if receipt.get("gift_message") else None,
        gift_sender=html.unescape(receipt["gift_sender"]) if receipt.get("gift_sender") else None,
        coupon=coupon,
        subtotal=_money(receipt.get("subtotal")),
        shipping_cost=_money(receipt.get("total_shipping_cost")),
        tax=_money(receipt.get("total_tax_cost")),
        shipping_method=first_t.get("shipping_method"),
        shipping_upgrade=first_t.get("shipping_upgrade"),
        shipments=shipments,
        has_personalization=personalized,
        is_canceled=(row.status or "").lower() in ("canceled", "fully refunded"),
    )


def _shipby_order(tab: str, nulls_last):
    """Gönderim tarihine göre sıra: gönderilecekler en yakın tarih önce (acil olan üstte); gönderilmiş/iptal olanlar en
    yeni tarih önce. "Tümü"nde gönderilecekler üstte (yakın→uzak), gönderilmişler altta (yeni→eski)."""
    d = OrderCache.expected_ship_date
    if tab == "toship":
        return (nulls_last, d.asc(), OrderCache.created_at.desc())
    if tab == "all":
        return (OrderCache.is_shipped.asc(), nulls_last, case((OrderCache.is_shipped.is_(False), d), else_=None).asc(), d.desc(), OrderCache.created_at.desc())
    return (nulls_last, d.desc(), OrderCache.created_at.desc())


def orders_page(
    db: Session,
    shop: Shop,
    *,
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
    page: int = 0,
    per_page: int = 50,
    today: dt.date | None = None,
) -> OrdersPageOut:
    """Sunucu tarafında filtrelenmiş ve sayfalanmış siparişler (5.000+ siparişi tarayıcıya yüklememek için)."""
    today = today or dt.datetime.utcnow().date()
    day0 = dt.datetime.combine(today, dt.time.min)
    base = select(OrderCache).where(OrderCache.shop_id == shop.id)

    def tab_cond(t: str):
        if t == "canceled":
            return OrderCache.is_canceled.is_(True)
        if t == "completed":
            return (OrderCache.is_canceled.is_(False)) & (OrderCache.is_shipped.is_(True))
        if t == "toship":
            return (OrderCache.is_canceled.is_(False)) & (OrderCache.is_shipped.is_(False))
        return None

    def count(t: str) -> int:
        cond = tab_cond(t)
        stmt = select(func.count()).select_from(OrderCache).where(OrderCache.shop_id == shop.id)
        if cond is not None:
            stmt = stmt.where(cond)
        return db.scalar(stmt) or 0

    counts = OrderCounts(toship=count("toship"), completed=count("completed"), canceled=count("canceled"), all=count("all"))

    conds = []
    if tab_cond(tab) is not None:
        conds.append(tab_cond(tab))
    dest_stmt = (
        select(OrderCache.country_iso, func.count())
        .where(OrderCache.shop_id == shop.id)
        .where(OrderCache.country_iso != "")
        .group_by(OrderCache.country_iso)
        .order_by(func.count().desc())
    )
    if tab_cond(tab) is not None:
        dest_stmt = dest_stmt.where(tab_cond(tab))
    destinations = [DestinationCount(iso=i, count=n) for i, n in db.execute(dest_stmt.limit(12)).all()]

    if ship_by != "all":
        e = OrderCache.expected_ship_date
        conds.append(
            {
                "overdue": e < day0,
                "today": (e >= day0) & (e < day0 + dt.timedelta(days=1)),
                "tomorrow": (e >= day0 + dt.timedelta(days=1)) & (e < day0 + dt.timedelta(days=2)),
                "week": (e >= day0) & (e < day0 + dt.timedelta(days=8)),
                "none": e.is_(None),
            }.get(ship_by, True)
        )
    if destination:
        conds.append(OrderCache.country_iso == destination)
    if channel in ("etsy", "pattern"):
        conds.append(OrderCache.channel == channel)
    for flag, col in ((note, OrderCache.has_note), (gift, OrderCache.is_gift), (personalized, OrderCache.has_personalization), (upgrade, OrderCache.has_upgrade)):
        if flag:
            conds.append(col.is_(True))
    for word in q.lower().split():
        conds.append(OrderCache.search_text.contains(word, autoescape=True))

    filtered = base.where(*conds) if conds else base
    total = db.scalar(select(func.count()).select_from(filtered.subquery())) or 0

    nulls_last = case((OrderCache.expected_ship_date.is_(None), 1), else_=0)
    order_by = {
        "shipby": _shipby_order(tab, nulls_last),
        "newest": (OrderCache.created_at.desc(),),
        "oldest": (OrderCache.created_at.asc(),),
        "total": (OrderCache.grandtotal_amount.desc(), OrderCache.created_at.desc()),
    }.get(sort, (nulls_last, OrderCache.expected_ship_date.asc()))
    rows = db.scalars(filtered.order_by(*order_by).offset(max(page, 0) * per_page).limit(per_page)).all()
    ids = {t.get("listing_id") for row in rows for t in json.loads(row.raw_json).get("transactions", []) if t.get("listing_id")}
    images = _listing_images(db, shop, ids)
    return OrdersPageOut(items=[_serialize_order(r, images) for r in rows], total=total, counts=counts, destinations=destinations)


def list_orders(db: Session, shop: Shop, needs_shipping: bool | None = None) -> list[OrderOut]:
    query = select(OrderCache).where(OrderCache.shop_id == shop.id)
    if needs_shipping:
        query = query.where(OrderCache.is_paid.is_(True)).where(OrderCache.is_shipped.is_(False))
    query = query.order_by(OrderCache.created_at.desc())
    rows = db.scalars(query).all()
    ids = {t.get("listing_id") for row in rows for t in json.loads(row.raw_json).get("transactions", []) if t.get("listing_id")}
    images = _listing_images(db, shop, ids)
    return [_serialize_order(row, images) for row in rows]


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
    row.raw_json = _receipt_json(receipt)
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

    return OrderInsightsOut(
        needs_shipping_today=needs_shipping_today,
        overdue=overdue,
    )

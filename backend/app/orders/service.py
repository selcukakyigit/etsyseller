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
from app.orders.derive import derive, fulfillment
from app.orders.models import OrderCache, OrderStep
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
    StepOut,
)
from app.core.i18n import tr
from app.shops.models import Shop


class OrderNotFound(Exception):
    pass


def _min_expected_ship_date(receipt: dict) -> dt.datetime | None:
    dates = [t["expected_ship_date"] for t in receipt.get("transactions", []) if t.get("expected_ship_date")]
    return dt.datetime.utcfromtimestamp(min(dates)) if dates else None


# Alıcı e-postası saklanmaz: buyer_email için Etsy'den ayrı izin istemiyoruz (Commercial Access şartı) ve gerekmiyor.
_DROPPED_RECEIPT_FIELDS = ("buyer_email", "payment_email")


# Etsy bu alanları bazı bölgelerde yalnızca ortak programdaki uygulamalara verir (bkz. getShopReceipt notu); gelmezse boş döner. Daha önce alınmış adres,
# yeni (maskeli) bir senkronda üzerine yazılıp kaybolmasın diye korunur.
_ADDRESS_FIELDS = ("first_line", "second_line", "city", "state", "zip", "country_iso", "formatted_address")


def _receipt_json(receipt: dict, previous_json: str | None = None) -> str:
    data = {k: v for k, v in receipt.items() if k not in _DROPPED_RECEIPT_FIELDS}
    if previous_json:
        try:
            old = json.loads(previous_json)
        except ValueError:
            old = {}
        for field in _ADDRESS_FIELDS:
            if not data.get(field) and old.get(field):
                data[field] = old[field]
    return json.dumps(data, ensure_ascii=False)


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
    row.raw_json = _receipt_json(receipt, row.raw_json)
    row.synced_at = dt.datetime.utcnow()
    for k, v in derive(json.loads(row.raw_json)).items():
        setattr(row, k, v)


_backfill_state: dict[int, dict] = {}


def sync_status(db: Session, shop: Shop) -> OrdersSyncStatus:
    state = _backfill_state.get(shop.id, {})
    local = _local_in_window(db, shop) if shop.history_years is not None else db.scalar(select(func.count()).select_from(OrderCache).where(OrderCache.shop_id == shop.id)) or 0
    return OrdersSyncStatus(local=local, remote_total=state.get("total"), backfilling=bool(state.get("running")))


def _backfill(shop_id: int) -> None:
    """Geçmiş siparişlerin tamamını arka planda indirir (sayfa sayfa; her sayfada kaydeder)."""
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        shop = db.get(Shop, shop_id)
        client = EtsyClient(db, shop)
        offset = 0
        since = _since_ts(shop)
        while True:
            params = {"limit": 100, "offset": offset, "sort_on": "created", "sort_order": "desc"}
            if since:
                params["min_created"] = since
            page = client.request("GET", f"/shops/{shop.etsy_shop_id}/receipts", params=params)
            for receipt in page["results"]:
                _upsert(db, shop, receipt)
            db.commit()
            offset += len(page["results"])
            _backfill_state[shop_id]["total"] = page["count"]
            if not page["results"] or offset >= page["count"]:
                break
        # Geçmiş siparişler geldi: Etsy hesap hareketleri (ücretler) en eski siparişten itibaren yeniden taranır; artımlı senkron eski dönemi doldurmaz.
        from app.finance import service as finance

        finance.start_sync(shop, full=True)
    except Exception:
        logging.getLogger(__name__).exception("Order backfill failed for shop %s", shop_id)
    finally:
        _backfill_state[shop_id]["running"] = False
        db.close()


def history_start(shop: Shop) -> dt.datetime | None:
    """Seçilen geçmişin başlangıcı (UTC); None = sınır yok (tümü) ya da henüz seçilmedi (`history_years` boş: çağıran ayrıca kontrol eder)."""
    if not shop.history_years:
        return None
    return dt.datetime.utcnow() - dt.timedelta(days=365 * shop.history_years)


def _since_ts(shop: Shop) -> int | None:
    start = history_start(shop)
    return int(start.replace(tzinfo=dt.timezone.utc).timestamp()) if start else None


def _local_in_window(db: Session, shop: Shop) -> int:
    q = select(func.count()).select_from(OrderCache).where(OrderCache.shop_id == shop.id)
    start = history_start(shop)
    if start is not None:
        q = q.where(OrderCache.created_at >= start)
    return db.scalar(q) or 0


def start_history_sync(shop_id: int) -> None:
    """Geçmiş seçimi yapılınca: son siparişleri hemen alır, geçmişi arka planda indirir ve finansı başlatır. İstek bu işi beklemesin diye ayrı iş parçacığında çalışır."""
    from app.core.db import SessionLocal

    def work() -> None:
        db = SessionLocal()
        try:
            shop = db.get(Shop, shop_id)
            sync_orders(db, shop)
            from app.finance import service as finance

            finance.start_sync(shop)  # artımlı; geçmiş inince _backfill tam senkronu ayrıca ister
        except Exception:
            logging.getLogger(__name__).exception("History sync failed for shop %s", shop_id)
        finally:
            db.close()

    threading.Thread(target=work, daemon=True).start()


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

    if shop.history_years is None:
        return len(receipts)  # geçmiş süresi henüz seçilmedi: yalnızca son siparişler; geçmiş indirme seçimden sonra başlar
    # Sayılar seçilen dönemdedir: "yerelde X / Etsy'de Y" ilerleme çubuğu ve eksik uyarısı pencereye göre doğru kalır.
    total = etsy_orders.count_receipts(client, _since_ts(shop))
    local = _local_in_window(db, shop)
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
        **fulfillment(receipt, row.created_at, row.delivered_at),
        has_personalization=personalized,
        is_canceled=(row.status or "").lower() in ("canceled", "fully refunded"),
        step_id=row.step_id,
    )


def _shipby_order(tab: str, nulls_last):
    """Gönderim tarihine göre sıra: gönderilecekler en yakın tarih önce (acil olan üstte); gönderilmiş/iptal olanlar en
    yeni tarih önce. "Tümü"nde gönderilecekler üstte (yakın→uzak), gönderilmişler altta (yeni→eski)."""
    d = OrderCache.expected_ship_date
    if tab == "toship" or tab.startswith("step:"):
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
        open_ = (OrderCache.is_canceled.is_(False)) & (OrderCache.is_shipped.is_(False))
        if t == "toship":  # "New": henüz bir adıma taşınmamış açık siparişler
            return open_ & OrderCache.step_id.is_(None)
        if t.startswith("step:") and t[5:].isdigit():
            return open_ & (OrderCache.step_id == int(t[5:]))
        return None

    def count(t: str) -> int:
        cond = tab_cond(t)
        stmt = select(func.count()).select_from(OrderCache).where(OrderCache.shop_id == shop.id)
        if cond is not None:
            stmt = stmt.where(cond)
        return db.scalar(stmt) or 0

    steps = list_steps(db, shop)
    counts = OrderCounts(
        toship=count("toship"), completed=count("completed"), canceled=count("canceled"), all=count("all"),
        steps=[StepOut(id=s.id, name=s.name, count=count(f"step:{s.id}")) for s in steps],
    )

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


LIST_ORDERS_MAX = 200  # eski, sayfasız uç nokta: binlerce siparişi tek seferde belleğe almasın (arayüz sayfalı `orders_page` kullanır)


def list_orders(db: Session, shop: Shop, needs_shipping: bool | None = None) -> list[OrderOut]:
    query = select(OrderCache).where(OrderCache.shop_id == shop.id)
    if needs_shipping:
        query = query.where(OrderCache.is_paid.is_(True)).where(OrderCache.is_shipped.is_(False))
    query = query.order_by(OrderCache.created_at.desc()).limit(LIST_ORDERS_MAX)
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
    if row.is_shipped:
        row.step_id = None  # tamamlanan sipariş artık bir ilerleme adımında durmaz
    row.status = receipt["status"]
    row.raw_json = _receipt_json(receipt, row.raw_json)
    row.synced_at = dt.datetime.utcnow()
    db.commit()
    return _serialize_order(row)


# ------------------------------------------------------------------ yerel ilerleme adımları

MAX_STEPS = 12
RESERVED_STEP_NAMES = {"new", "completed", "all", "yeni", "tamamlandı", "tümü"}


class StepError(ValueError):
    """Kullanıcıya gösterilecek adım doğrulama hatası."""


def list_steps(db: Session, shop: Shop) -> list[OrderStep]:
    return list(db.scalars(select(OrderStep).where(OrderStep.shop_id == shop.id).order_by(OrderStep.position, OrderStep.id)))


def save_steps(db: Session, shop: Shop, items: list[tuple[int | None, str]]) -> list[OrderStep]:
    """Adımların tamamını verilen sırayla kaydeder: kimliği olan yeniden adlandırılır/sıralanır, kimliği olmayan eklenir, listede olmayan silinir
    (o adımdaki siparişler New'e döner). Kimlikler yalnızca bu mağazanın adımlarından biri olabilir."""
    existing = {s.id: s for s in list_steps(db, shop)}
    names = [" ".join(n.split()) for _, n in items]
    if len(items) > MAX_STEPS:
        raise StepError(tr(f"En fazla {MAX_STEPS} adım olabilir.", f"You can have at most {MAX_STEPS} steps."))
    if any(not n or len(n) > 40 for n in names):
        raise StepError(tr("Adım adı boş olamaz ve en fazla 40 karakter olabilir.", "A step name cannot be empty and can be at most 40 characters."))
    if any(n.lower() in RESERVED_STEP_NAMES for n in names):
        raise StepError(tr("New, Completed ve All adları sabittir; başka ad seç.", "New, Completed and All are fixed names; pick another name."))
    if len({n.lower() for n in names}) != len(names):
        raise StepError(tr("Aynı adlı iki adım olamaz.", "Two steps cannot have the same name."))
    if any(i is not None and i not in existing for i, _ in items):
        raise StepError(tr("Adım bulunamadı.", "Step not found."))
    keep = {i for i, _ in items if i is not None}
    for sid, step in existing.items():
        if sid not in keep:
            db.query(OrderCache).filter(OrderCache.shop_id == shop.id, OrderCache.step_id == sid).update({OrderCache.step_id: None})
            db.delete(step)
    db.flush()  # silinen adların benzersizlik kısıtı yeni/yeniden adlandırılanlarla çakışmasın
    for (sid, _), name in zip(items, names):  # adları takas ederken geçici çakışma olmasın: önce ad değişenlere geçici ad
        if sid is not None and existing[sid].name != name:
            existing[sid].name = f"~{sid}~"
    db.flush()
    out: list[OrderStep] = []
    for pos, ((sid, _), name) in enumerate(zip(items, names)):
        step = existing[sid] if sid is not None else OrderStep(shop_id=shop.id, name=name)
        step.name, step.position = name, pos
        if sid is None:
            db.add(step)
        out.append(step)
    db.commit()
    return out


def move_orders(db: Session, shop: Shop, receipt_ids: list[int], step_id: int | None) -> int:
    """Açık (gönderilmemiş, iptal olmamış) siparişleri bir adıma taşır; step_id boşsa New'e döndürür. Döner: taşınan sipariş sayısı."""
    if step_id is not None and not db.scalar(select(func.count()).select_from(OrderStep).where(OrderStep.id == step_id, OrderStep.shop_id == shop.id)):
        raise StepError(tr("Adım bulunamadı.", "Step not found."))
    rows = db.scalars(
        select(OrderCache).where(OrderCache.shop_id == shop.id, OrderCache.receipt_id.in_(receipt_ids[:500]), OrderCache.is_shipped.is_(False), OrderCache.is_canceled.is_(False))
    ).all()
    for row in rows:
        row.step_id = step_id
    db.commit()
    return len(rows)


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

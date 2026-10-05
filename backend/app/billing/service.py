"""Ödeme tarafının veritabanı işleri: Lemon Squeezy webhook olaylarının işlenmesi, çalışma alanının aboneliği ve hesap
silinirken aboneliklerin iptali. HTTP çağrıları lemon.py'de, bakiye hareketleri credits.py'de.

Olaylar sırasız ve tekrarlı gelebilir. Kredi yüklemeleri Lemon'daki sipariş/fatura numarasıyla (`ref`) tekilleşir.
Abonelik ödemesi, abonelik kaydından önce gelirse hata verilir; Lemon olayı sonra yeniden gönderir."""
import datetime as dt
import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.billing import credits, lemon
from app.billing.models import BillingEvent, BillingProduct, Subscription

log = logging.getLogger(__name__)

# Bu durumlardaki abonelik "var" sayılır: yeni plan satın alınamaz, hesap silinirken iptal edilir.
LIVE_STATUSES = ("on_trial", "active", "paused", "past_due", "unpaid")


class EventError(Exception):
    pass


def _ts(value) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(dt.timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed


def _workspace_id(meta: dict, fallback: int | None = None) -> int | None:
    raw = (meta.get("custom_data") or {}).get("workspace_id")
    try:
        return int(raw) if raw not in (None, "") else fallback
    except (TypeError, ValueError):
        return fallback


def product_by_variant(db: Session, variant_id) -> BillingProduct | None:
    return db.scalar(select(BillingProduct).where(BillingProduct.variant_id == str(variant_id))) if variant_id else None


def live_subscription(db: Session, workspace_id: int) -> Subscription | None:
    return db.scalar(
        select(Subscription)
        .where(Subscription.workspace_id == workspace_id, Subscription.status.in_(LIVE_STATUSES))
        .order_by(Subscription.id.desc())
        .limit(1)
    )


def _order_created(db: Session, data: dict, meta: dict) -> int | None:
    attrs = data["attributes"]
    ws = _workspace_id(meta)
    if attrs.get("status") != "paid":
        return ws
    product = product_by_variant(db, (attrs.get("first_order_item") or {}).get("variant_id"))
    if product is None or product.kind != "pack":
        return ws  # plan siparişinin kredisi subscription_payment_success ile gelir
    if ws is None:
        raise EventError("Siparişte çalışma alanı yok (custom_data.workspace_id)")
    credits.grant(db, ws, product.credits, kind="purchase", ref=f"order:{data['id']}", note=product.name_en)
    return ws


def _order_refunded(db: Session, data: dict, meta: dict) -> int | None:
    attrs = data["attributes"]
    ws = _workspace_id(meta)
    product = product_by_variant(db, (attrs.get("first_order_item") or {}).get("variant_id"))
    if product is None or product.kind != "pack" or ws is None:
        return ws
    # İade edilen paketin kredisi geri alınır (harcandıysa bakiye eksiye düşebilir; yönetici düzeltebilir).
    credits.grant(db, ws, -product.credits, kind="refund", ref=f"refund:{data['id']}", note=f"Refund: {product.name_en}")
    return ws


def _subscription_changed(db: Session, data: dict, meta: dict) -> int | None:
    attrs = data["attributes"]
    lemon_id = str(data["id"])
    row = db.scalar(select(Subscription).where(Subscription.lemon_subscription_id == lemon_id))
    ws = _workspace_id(meta, row.workspace_id if row else None)
    if ws is None:
        raise EventError("Abonelikte çalışma alanı yok (custom_data.workspace_id)")
    variant_id = str(attrs.get("variant_id") or "")
    product = product_by_variant(db, variant_id)
    now = dt.datetime.utcnow()
    if row is None:
        row = Subscription(workspace_id=ws, lemon_subscription_id=lemon_id, created_at=now)
        db.add(row)
    row.workspace_id = ws
    row.variant_id = variant_id
    row.product_id = product.id if product else None
    row.status = str(attrs.get("status") or "")
    row.renews_at = _ts(attrs.get("renews_at"))
    row.ends_at = _ts(attrs.get("ends_at"))
    row.portal_url = ((attrs.get("urls") or {}).get("customer_portal") or None)
    row.updated_at = now
    db.commit()
    if row.status == "expired":
        credits.clear_plan(db, ws, ref=f"expired:{lemon_id}", note="Subscription expired")
    return ws


def _payment_success(db: Session, data: dict, meta: dict) -> int | None:
    attrs = data["attributes"]
    lemon_id = str(attrs.get("subscription_id") or "")
    row = db.scalar(select(Subscription).where(Subscription.lemon_subscription_id == lemon_id))
    if row is None:
        raise EventError(f"Abonelik henüz kayıtlı değil ({lemon_id}); Lemon olayı yeniden gönderecek")
    product = db.get(BillingProduct, row.product_id) if row.product_id else product_by_variant(db, row.variant_id)
    if product is None:
        raise EventError(f"Aboneliğin planı ürünlerde yok (varyant {row.variant_id})")
    credits.reset_plan(db, row.workspace_id, product.credits, ref=f"invoice:{data['id']}", note=product.name_en)
    return row.workspace_id


HANDLERS = {
    "order_created": _order_created,
    "order_refunded": _order_refunded,
    "subscription_created": _subscription_changed,
    "subscription_updated": _subscription_changed,
    "subscription_cancelled": _subscription_changed,
    "subscription_resumed": _subscription_changed,
    "subscription_expired": _subscription_changed,
    "subscription_paused": _subscription_changed,
    "subscription_unpaused": _subscription_changed,
    "subscription_payment_success": _payment_success,
}


def handle_event(db: Session, payload: dict) -> None:
    """Olayı işler ve kaydeder. İşlenemezse kaydı ok=False ile yazar ve hatayı yeniden fırlatır (Lemon yeniden dener)."""
    meta = payload.get("meta") or {}
    name = str(meta.get("event_name") or "")
    data = payload.get("data") or {}
    event = BillingEvent(event_name=name[:60], lemon_id=str(data.get("id") or "")[:40] or None, ok=True, payload=summary(payload))
    handler = HANDLERS.get(name)
    try:
        if handler is not None:
            event.workspace_id = handler(db, data, meta)
    except Exception as exc:
        db.rollback()
        event.ok = False
        event.error = f"{type(exc).__name__}: {exc}"[:300]
        db.add(event)
        db.commit()
        raise
    db.add(event)
    db.commit()


def cancel_for_workspaces(db: Session, workspace_ids: list[int]) -> None:
    """Hesap silinmeden önce çağrılır: silinen hesaptan ödeme alınmaya devam edilmesin. İptal edilemezse hata fırlatır,
    silme durur ve tekrar denenebilir."""
    if not workspace_ids:
        return
    rows = db.scalars(select(Subscription).where(Subscription.workspace_id.in_(workspace_ids), Subscription.status.in_(LIVE_STATUSES))).all()
    for row in rows:
        try:
            lemon.cancel_subscription(row.lemon_subscription_id)
        except lemon.LemonError as exc:
            raise RuntimeError(f"Abonelik iptal edilemedi, hesap silinmedi: {exc}") from exc


# Kayda yalnızca sorun gidermeye yeten alanlar yazılır; müşterinin adı, e-postası ve kart bilgisi saklanmaz.
_KEPT_ATTRS = (
    "status", "variant_id", "product_id", "subscription_id", "billing_reason", "renews_at", "ends_at", "total", "currency",
    "refunded", "test_mode", "created_at",
)


def summary(payload: dict) -> str:
    meta = payload.get("meta") or {}
    data = payload.get("data") or {}
    attrs = data.get("attributes") or {}
    kept = {k: attrs[k] for k in _KEPT_ATTRS if k in attrs}
    if isinstance(attrs.get("first_order_item"), dict):
        kept["first_order_item"] = {k: attrs["first_order_item"].get(k) for k in ("variant_id", "product_id", "price")}
    out = {"event_name": meta.get("event_name"), "custom_data": meta.get("custom_data"), "type": data.get("type"), "id": data.get("id"), "attributes": kept}
    return json.dumps(out, ensure_ascii=False, default=str)

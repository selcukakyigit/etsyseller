"""Ödeme tarafının veritabanı işleri: Lemon Squeezy webhook olaylarının işlenmesi (kredi paketi satın alma ve iade). HTTP çağrıları lemon.py'de,
bakiye hareketleri credits.py'de.

Olaylar sırasız ve tekrarlı gelebilir. Kredi yüklemeleri Lemon'daki sipariş numarasıyla (`ref`) tekilleşir."""
import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.billing import credits, custom
from app.billing.models import BillingEvent, BillingProduct, CreditLedger
from app.core.config import settings

log = logging.getLogger(__name__)

class EventError(Exception):
    pass


def _workspace_id(meta: dict, fallback: int | None = None) -> int | None:
    raw = (meta.get("custom_data") or {}).get("workspace_id")
    try:
        return int(raw) if raw not in (None, "") else fallback
    except (TypeError, ValueError):
        return fallback


def product_by_variant(db: Session, variant_id) -> BillingProduct | None:
    return db.scalar(select(BillingProduct).where(BillingProduct.variant_id == str(variant_id))) if variant_id else None


def _variant(attrs: dict) -> str:
    return str((attrs.get("first_order_item") or {}).get("variant_id") or "")


def _order_created(db: Session, data: dict, meta: dict) -> int | None:
    attrs = data["attributes"]
    ws = _workspace_id(meta)
    if attrs.get("status") != "paid":
        return ws
    variant = _variant(attrs)
    wanted = (meta.get("custom_data") or {}).get("custom_credits")
    custom_variant = str(settings.lemonsqueezy_custom_variant_id or "")
    if (custom_variant and variant == custom_variant) or wanted not in (None, ""):
        # Özel miktar yalnızca kendi ürününde geçerlidir. Özel fiyatlı bir ödeme sayfasında müşteri başka bir paketi seçmişse, ödediği tutar o
        # paketin kredisini karşılamaz: kredi yüklenmez, olay hatalı kaydedilir ve yönetici bakar.
        if not custom_variant or variant != custom_variant or wanted in (None, ""):
            raise EventError(f"Özel miktar siparişi tutarsız (varyant {variant}, miktar {wanted!r})")
        if ws is None:
            raise EventError("Siparişte çalışma alanı yok (custom_data.workspace_id)")
        credits.grant(db, ws, _custom_amount(db, attrs, wanted), kind="purchase", ref=f"order:{data['id']}", note="Custom")
        return ws
    product = product_by_variant(db, variant)
    if product is None:
        return ws
    if ws is None:
        raise EventError("Siparişte çalışma alanı yok (custom_data.workspace_id)")
    credits.grant(db, ws, product.credits, kind="purchase", ref=f"order:{data['id']}", note=product.name_en)
    return ws


def _custom_amount(db: Session, attrs: dict, raw) -> int:
    """Özel miktar siparişinde yüklenecek kredi. custom_data bizim oluşturduğumuz ödeme sayfasından gelir ama kullanıcı adresi değiştirebilir;
    bu yüzden ödenen vergisiz tutar (subtotal) o miktarın sunucudaki fiyatını karşılamıyorsa kredi yüklenmez."""
    try:
        credits_wanted = int(raw)
        q = custom.quote(db, credits_wanted)
    except (ValueError, custom.CustomError) as exc:
        raise EventError(f"Özel kredi miktarı geçersiz: {raw}") from exc
    # Mağaza para birimiyle (USD) karşılaştırılır: müşteri başka para biriminde ödediyse `subtotal` o birimdedir, `subtotal_usd` ise mağazanınkidir.
    paid = attrs.get("subtotal_usd") if isinstance(attrs.get("subtotal_usd"), int) else attrs.get("subtotal")
    if not isinstance(paid, int) or paid < q["price_cents"]:
        raise EventError(f"Ödenen tutar ({paid}) {credits_wanted} kredinin fiyatını ({q['price_cents']}) karşılamıyor")
    return credits_wanted


def _order_refunded(db: Session, data: dict, meta: dict) -> int | None:
    attrs = data["attributes"]
    ws = _workspace_id(meta)
    if ws is None:
        return ws
    # İade edilen siparişin yüklediği kredi geri alınır (özel miktarda paketin değil, gerçekten yüklenen miktar). Harcandıysa bakiye eksiye
    # düşebilir; yönetici düzeltebilir.
    granted = db.scalar(select(CreditLedger.delta).where(CreditLedger.ref == f"order:{data['id']}"))
    product = product_by_variant(db, _variant(attrs))
    amount = granted or (product.credits if product else 0)
    if not amount:
        return ws
    note = "Custom" if granted and product is None else product.name_en if product else "Custom"
    credits.grant(db, ws, -amount, kind="refund", ref=f"refund:{data['id']}", note=f"Refund: {note}")
    return ws


HANDLERS = {
    "order_created": _order_created,
    "order_refunded": _order_refunded,
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


# Kayda yalnızca sorun gidermeye yeten alanlar yazılır; müşterinin adı, e-postası ve kart bilgisi saklanmaz.
_KEPT_ATTRS = (
    "status", "variant_id", "product_id", "total", "currency",
    "refunded", "test_mode", "created_at", "total_usd", "refunded_amount",
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

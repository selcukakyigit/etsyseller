"""Etsy makbuzundan (receipt) sorgulanabilir sütunlar türetir. Filtre/arama/sayfalama SQL'de yapılabilsin diye
her senkronizasyonda ve migration'da aynı fonksiyon kullanılır."""

import datetime as dt
import html


def derive(receipt: dict) -> dict:
    txs = receipt.get("transactions") or []
    personalized = False
    parts = [receipt.get("name") or "", str(receipt.get("receipt_id", "")), receipt.get("city") or ""]
    for t in txs:
        parts += [html.unescape(t.get("title") or ""), t.get("sku") or ""]
        for v in t.get("variations") or []:
            name = (v.get("formatted_name") or "").strip().lower()
            if name == "personalization" or v.get("question_id"):
                personalized = True
            parts.append(html.unescape(v.get("formatted_value") or ""))
    status = (receipt.get("status") or "").lower()
    return {
        "country_iso": receipt.get("country_iso") or "",
        "channel": "pattern" if receipt.get("receipt_type") == 1 else "etsy",
        "is_gift": bool(receipt.get("is_gift")),
        "has_note": bool(receipt.get("message_from_buyer")),
        "has_personalization": personalized,
        "has_upgrade": any(t.get("shipping_upgrade") for t in txs),
        "is_canceled": status in ("canceled", "fully refunded"),
        "search_text": " ".join(parts).lower(),
    }


def _days(a: dt.datetime | None, b: dt.datetime | None) -> int | None:
    if a is None or b is None:
        return None
    return max(0, round((b - a).total_seconds() / 86400))


def fulfillment(receipt: dict, created_at: dt.datetime, delivered_at: dt.datetime | None) -> dict:
    """Kargo süreleri. Kargoya verilme: ilk gönderim bildiriminin (yoksa kalemlerin shipped_timestamp'inin) zamanı.
    Teslim: yalnızca order.delivered webhook'undan bilinir (Etsy makbuzunda bu alan yok). Gün sayıları tam güne yuvarlanır;
    `ship_days` ödeme→kargo, `transit_days` kargo→teslim, `total_days` ödeme→teslim."""
    txs = receipt.get("transactions") or []
    paid = [t["paid_timestamp"] for t in txs if t.get("paid_timestamp")]
    paid_at = dt.datetime.utcfromtimestamp(min(paid)) if paid else created_at
    stamps = [s["shipment_notification_timestamp"] for s in receipt.get("shipments") or [] if s.get("shipment_notification_timestamp")]
    stamps = stamps or [t["shipped_timestamp"] for t in txs if t.get("shipped_timestamp")]
    shipped_at = dt.datetime.utcfromtimestamp(min(stamps)) if stamps else None
    return {
        "shipped_at": shipped_at.isoformat() + "Z" if shipped_at else None,
        "delivered_at": delivered_at.isoformat() + "Z" if delivered_at else None,
        "ship_days": _days(paid_at, shipped_at),
        "transit_days": _days(shipped_at, delivered_at),
        "total_days": _days(paid_at, delivered_at),
    }

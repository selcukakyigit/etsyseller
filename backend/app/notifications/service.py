import datetime as dt
import html
import json
import logging

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import User, WorkspaceMember
from app.core.config import settings
from app.emails.renderer import render
from app.emails.sender import send_email
from app.notifications.models import Notification
from app.shops.models import Shop

logger = logging.getLogger(__name__)

KIND_BY_EVENT = {
    "order.paid": "order_paid",
    "order.canceled": "order_canceled",
    "order.shipped": "order_shipped",
    "order.delivered": "order_delivered",
}
RETENTION = dt.timedelta(days=90)


def _order_data(receipt: dict) -> dict:
    txs = receipt.get("transactions") or []
    total = receipt.get("grandtotal") or {}
    shipments = receipt.get("shipments") or []
    last = shipments[-1] if shipments else {}
    return {
        "buyer": receipt.get("name") or "",
        "amount": total.get("amount"),
        "divisor": total.get("divisor") or 100,
        "currency": total.get("currency_code") or "",
        "items": sum(t.get("quantity") or 1 for t in txs),
        "title": html.unescape(txs[0].get("title") or "") if txs else "",
        "listing_id": txs[0].get("listing_id") if txs else None,
        "carrier": last.get("carrier_name") or "",
        "tracking": last.get("tracking_code") or "",
    }


def record_order_event(db: Session, shop: Shop, event_type: str, receipt: dict) -> Notification | None:
    """Bildirimi ekler; aynı olay daha önce kaydedildiyse None döner (yan etkiler ikinci kez çalışmasın)."""
    kind = KIND_BY_EVENT.get(event_type)
    if kind is None:
        return None
    row = Notification(shop_id=shop.id, kind=kind, receipt_id=receipt["receipt_id"], data_json=json.dumps(_order_data(receipt), ensure_ascii=False))
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return row


def serialize(row: Notification) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "receipt_id": row.receipt_id,
        "data": json.loads(row.data_json or "{}"),
        "created_at": row.created_at.isoformat() + "Z",
        "read": row.read_at is not None,
    }


def list_for_shop(db: Session, shop: Shop, limit: int = 30) -> dict:
    rows = db.scalars(select(Notification).where(Notification.shop_id == shop.id).order_by(Notification.created_at.desc()).limit(limit)).all()
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.shop_id == shop.id, Notification.read_at.is_(None))) or 0
    return {"items": [serialize(r) for r in rows], "unread": unread}


def mark_all_read(db: Session, shop: Shop) -> None:
    db.execute(update(Notification).where(Notification.shop_id == shop.id, Notification.read_at.is_(None)).values(read_at=dt.datetime.utcnow()))
    db.commit()


def purge_old(db: Session) -> int:
    rows = db.scalars(select(Notification).where(Notification.created_at < dt.datetime.utcnow() - RETENTION).limit(5000)).all()
    for r in rows:
        db.delete(r)
    db.commit()
    return len(rows)


def _money(data: dict) -> str:
    if data.get("amount") is None:
        return ""
    return f"{data['amount'] / (data.get('divisor') or 100):,.2f} {data.get('currency', '')}".strip()


def email_new_order(db: Session, shop: Shop, notif: Notification) -> None:
    """Mağazanın çalışma alanında "yeni siparişte e-posta" tercihini açmış her üyeye kendi dilinde e-posta."""
    users = db.scalars(
        select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == shop.workspace_id, User.notify_order_email.is_(True))
    ).all()
    if not users:
        return
    data = json.loads(notif.data_json)
    money = _money(data)
    url = f"{settings.frontend_url.rstrip('/')}/orders"
    shop_name = getattr(shop, "shop_name", None) or ""
    for user in users:
        en = user.email_lang == "en"
        subject = (f"New order #{notif.receipt_id}" if en else f"Yeni sipariş #{notif.receipt_id}") + (f" · {money}" if money else "")
        rows = [
            ("Shop" if en else "Mağaza", shop_name),
            ("Buyer" if en else "Alıcı", data.get("buyer") or "-"),
            ("Items" if en else "Ürün", f"{data.get('items')} × {data.get('title')}" if data.get("items", 0) == 1 else f"{data.get('items')} ({data.get('title')} …)"),
            ("Total" if en else "Toplam", money or "-"),
        ]
        markup, text = render(
            "order_notification.html",
            title=subject,
            preheader=f"{data.get('title', '')}",
            heading=subject,
            rows=[r for r in rows if r[1]],
            url=url,
            button_label="Open orders" if en else "Siparişleri aç",
            footer=(
                "You get this email because new-order emails are on in Ulagg settings › Notifications."
                if en else "Bu e-postayı Ulagg Ayarlar › Bildirimler'de yeni sipariş e-postaları açık olduğu için alıyorsun."
            ),
        )
        send_email([user.email], subject, markup, text)

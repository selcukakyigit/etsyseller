"""Etsy webhook'ları (order.paid / canceled / shipped / delivered).

Etsy olay olunca buraya POST atar; gövdede yalnızca event_type, shop_id ve resource_url (ilgili receipt) bulunur.
İmzayı doğrulayıp hemen 200 döneriz, gerisi arka planda yapılır (Etsy yavaş yanıtı hata sayıp tekrar dener):
  - sipariş Etsy'den çekilip yerel önbelleğe yazılır (satış ölçümü ve diagnosis siparişleri buradan okur),
  - bildirim kaydedilir (zil menüsü); order.paid'de isteyen üyelere e-posta gider,
  - order.paid / order.canceled: satılan ilanların stoğu ve finans hareketleri tazelenir,
  - order.delivered: teslim zamanı kaydedilir (Etsy makbuzunda bu alan yok; kargo süresi buradan hesaplanır).
Yan etkiler yalnızca bildirim ilk kez kaydedildiğinde çalışır, tekrar gelen olay bir şey tetiklemez. 2 saatlik
order_sync yedek olarak çalışmaya devam eder (kaçan olay olursa).
"""

import base64
import hashlib
import hmac
import json
import logging
import re
import threading
import time
from collections import OrderedDict

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal
import datetime as dt

from app.etsy.client import EtsyAuthError, EtsyClient
from app.finance import service as finance
from app.listings.service import _fetch_and_cache_one
from app.notifications import service as notifications
from app.orders.models import OrderCache
from app.orders.service import _upsert
from app.shops.models import Shop

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])

TOLERANCE_SECONDS = 300
HANDLED_EVENTS = {"order.paid", "order.canceled", "order.shipped", "order.delivered"}

# Etsy aynı mesajı (aynı webhook-id) tekrar gönderebilir; yakın zamanda işlenenleri atla. İşlem zaten idempotent
# (upsert), bu yalnızca gereksiz Etsy çağrısını önler.
_seen: OrderedDict[str, None] = OrderedDict()
_seen_lock = threading.Lock()
_SEEN_MAX = 5000


def _secret_bytes(secret: str) -> bytes:
    return base64.b64decode(secret.split("_", 1)[1] if secret.startswith("whsec_") else secret)


def verify_signature(secret: str, msg_id: str, timestamp: str, body: bytes, signature_header: str) -> bool:
    signed = f"{msg_id}.{timestamp}.".encode() + body
    expected = base64.b64encode(hmac.new(_secret_bytes(secret), signed, hashlib.sha256).digest()).decode()
    # Başlık boşlukla ayrılmış "v1,<imza>" girdileri taşıyabilir (anahtar yenilenirken birden fazla).
    for entry in signature_header.split():
        sig = entry.split(",", 1)[1] if "," in entry else entry
        if hmac.compare_digest(sig, expected):
            return True
    return False


def _already_seen(msg_id: str) -> bool:
    with _seen_lock:
        if msg_id in _seen:
            return True
        _seen[msg_id] = None
        if len(_seen) > _SEEN_MAX:
            _seen.popitem(last=False)
        return False


def _refresh_listings(db, shop: Shop, client: EtsyClient, receipt: dict) -> None:
    """Satılan / iptalde geri dönen ürünlerin stoğu değişti: ilgili ilanları tek tek yenile."""
    for listing_id in {t.get("listing_id") for t in receipt.get("transactions") or [] if t.get("listing_id")}:
        try:
            _fetch_and_cache_one(db, shop, client, listing_id)
        except Exception:
            db.rollback()
            logger.warning("Webhook: ilan %s yenilenemedi", listing_id, exc_info=True)


def _handle(etsy_shop_id: int, receipt_id: int, event_type: str, emitted_at: dt.datetime) -> None:
    db = SessionLocal()
    try:
        shop = db.scalars(select(Shop).where(Shop.etsy_shop_id == etsy_shop_id)).one_or_none()
        if shop is None or shop.is_demo or shop.oauth_token is None:
            logger.info("Webhook %s: mağaza %s bağlı değil, atlandı", event_type, etsy_shop_id)
            return
        client = EtsyClient(db, shop)
        receipt = client.request("GET", f"/shops/{etsy_shop_id}/receipts/{receipt_id}")
        _upsert(db, shop, receipt)
        if event_type == "order.delivered":
            row = db.scalars(select(OrderCache).where(OrderCache.shop_id == shop.id, OrderCache.receipt_id == receipt_id)).one()
            row.delivered_at = row.delivered_at or emitted_at
        db.commit()
        logger.info("Webhook %s: sipariş %s güncellendi (mağaza %s)", event_type, receipt_id, shop.id)

        notif = notifications.record_order_event(db, shop, event_type, receipt)
        if notif is None:
            return  # aynı olay daha önce işlendi
        if event_type in ("order.paid", "order.canceled"):
            _refresh_listings(db, shop, client, receipt)
            finance.start_sync(shop)  # artımlı; zaten çalışıyorsa bir şey yapmaz
        if event_type == "order.paid":
            notifications.email_new_order(db, shop, notif)
    except EtsyAuthError as exc:
        logger.warning("Webhook %s: mağaza %s yetki hatası: %s", event_type, etsy_shop_id, exc)
    except Exception:
        logger.exception("Webhook %s: sipariş %s işlenemedi", event_type, receipt_id)
    finally:
        db.close()


@router.post("/etsy", include_in_schema=False)
async def etsy_webhook(request: Request, background: BackgroundTasks):
    # Geçiş süresince iki Etsy uygulaması aynı uç noktaya gönderir; her biri kendi secret'ıyla imzalar.
    secrets = [s for s in (settings.etsy_webhook_secret, settings.etsy_webhook_secret_new) if s]
    if not secrets:
        raise HTTPException(status_code=503, detail="Webhook yapılandırılmamış.")

    body = await request.body()
    msg_id = request.headers.get("webhook-id", "")
    timestamp = request.headers.get("webhook-timestamp", "")
    signature = request.headers.get("webhook-signature", "")
    if not (msg_id and timestamp and signature):
        raise HTTPException(status_code=400, detail="Eksik webhook başlıkları.")
    try:
        if abs(time.time() - int(timestamp)) > TOLERANCE_SECONDS:
            raise HTTPException(status_code=400, detail="Webhook zaman damgası geçersiz.")
    except ValueError:
        raise HTTPException(status_code=400, detail="Webhook zaman damgası geçersiz.")
    if not any(verify_signature(s, msg_id, timestamp, body, signature) for s in secrets):
        raise HTTPException(status_code=401, detail="Webhook imzası geçersiz.")

    payload = json.loads(body)
    event_type = payload.get("event_type", "")
    if event_type not in HANDLED_EVENTS or _already_seen(msg_id):
        return {"ok": True}

    # resource_url'e doğrudan istek atmıyoruz (gövdeden gelen URL'yi takip etmek yerine kendi yolumuzu kuruyoruz);
    # yalnızca sondaki receipt numarasını alıyoruz.
    match = re.search(r"/receipts/(\d+)", payload.get("resource_url") or "")
    shop_id = payload.get("shop_id")
    if not match or not isinstance(shop_id, int):
        logger.warning("Webhook %s: beklenmeyen gövde: %s", event_type, body[:300])
        return {"ok": True}

    background.add_task(_handle, shop_id, int(match.group(1)), event_type, dt.datetime.utcfromtimestamp(int(timestamp)))
    return {"ok": True}

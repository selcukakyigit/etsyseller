"""Lemon Squeezy webhook'u. Lemon'da Settings > Webhooks'ta adres `https://api.ulagg.com/webhooks/lemonsqueezy`, sır
LEMONSQUEEZY_WEBHOOK_SECRET ile aynı olmalı; olaylar: order_created, order_refunded, subscription_* ve
subscription_payment_success.

İmza ham gövde üzerinden doğrulanır. İşleme hatasında 500 dönülür ki Lemon yeniden denesin; kredi yüklemeleri
tekilleştiği için tekrar gelen olay çift kredi vermez."""
import json
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from app.billing import lemon, service
from app.core.config import settings
from app.core.db import SessionLocal

log = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["billing"])


def _process(payload: dict) -> None:
    db = SessionLocal()
    try:
        service.handle_event(db, payload)
    finally:
        db.close()


@router.post("/lemonsqueezy", include_in_schema=False)
async def lemonsqueezy(request: Request):
    if not settings.lemonsqueezy_webhook_secret:
        raise HTTPException(503, "Webhook not configured")
    body = await request.body()
    if not lemon.valid_signature(body, request.headers.get("x-signature", "")):
        raise HTTPException(401, "Invalid signature")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Invalid JSON") from exc
    try:
        await run_in_threadpool(_process, payload)
    except Exception as exc:  # noqa: BLE001 — Lemon'un yeniden denemesi için 500
        log.exception("Lemon webhook işlenemedi: %s", (payload.get("meta") or {}).get("event_name"))
        raise HTTPException(500, "Event could not be processed") from exc
    return {"ok": True}

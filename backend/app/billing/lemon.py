"""Lemon Squeezy API'si: ödeme sayfası açma, abonelik iptali ve webhook imzası. Yalnızca HTTP; veritabanına dokunmaz."""
import hashlib
import hmac
import logging

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)
API = "https://api.lemonsqueezy.com/v1"
TIMEOUT = 20


class LemonError(Exception):
    pass


def configured() -> bool:
    return bool(settings.lemonsqueezy_api_key and settings.lemonsqueezy_store_id)


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.lemonsqueezy_api_key}",
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
    }


def create_checkout(variant_id: str, email: str, custom: dict[str, str], redirect_url: str) -> str:
    """Bu kullanıcıya özel ödeme sayfası açar, adresini döner. `custom` (çalışma alanı no. vb.) Lemon tarafından her
    webhook'ta `meta.custom_data` olarak geri gönderilir; kredinin kime yükleneceği buradan bilinir."""
    if not configured():
        raise LemonError("Ödeme sistemi yapılandırılmamış.")
    body = {
        "data": {
            "type": "checkouts",
            "attributes": {
                "checkout_data": {"email": email, "custom": {k: str(v) for k, v in custom.items()}},
                "product_options": {"redirect_url": redirect_url},
            },
            "relationships": {
                "store": {"data": {"type": "stores", "id": str(settings.lemonsqueezy_store_id)}},
                "variant": {"data": {"type": "variants", "id": str(variant_id)}},
            },
        }
    }
    try:
        resp = httpx.post(f"{API}/checkouts", json=body, headers=_headers(), timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise LemonError("Ödeme sağlayıcısına ulaşılamadı.") from exc
    if resp.status_code >= 300:
        log.error("Lemon checkout hatası %s: %s", resp.status_code, resp.text[:500])
        raise LemonError("Ödeme sayfası açılamadı.")
    return resp.json()["data"]["attributes"]["url"]


def cancel_subscription(lemon_subscription_id: str) -> None:
    """Aboneliği iptal eder (Lemon'da dönem sonunda biter). Zaten yoksa sorun sayılmaz."""
    if not configured():
        raise LemonError("Ödeme sistemi yapılandırılmamış.")
    try:
        resp = httpx.delete(f"{API}/subscriptions/{lemon_subscription_id}", headers=_headers(), timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise LemonError("Ödeme sağlayıcısına ulaşılamadı.") from exc
    if resp.status_code not in (200, 204, 404):
        log.error("Lemon abonelik iptali hatası %s: %s", resp.status_code, resp.text[:500])
        raise LemonError("Abonelik iptal edilemedi.")


def valid_signature(body: bytes, signature: str) -> bool:
    secret = settings.lemonsqueezy_webhook_secret
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

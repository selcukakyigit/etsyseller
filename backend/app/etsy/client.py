import datetime as dt
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.etsy import oauth as etsy_oauth
from app.etsy import rate_limit
from app.shops.models import OAuthToken, Shop

API_BASE = "https://api.etsy.com/v3/application"

import logging as _logging
import threading as _threading
import time as _time

_log = _logging.getLogger("etsy")
_writes = _threading.local()  # istek başına (iş parçacığı başına) Etsy yazma sayacı


def write_count() -> int:
    return getattr(_writes, "n", 0)


# Aynı mağazanın token'ını aynı anda iki iş parçacığının (ör. arka plan senkronu + kullanıcı isteği) birden
# yenilemeye çalışmasını önler — Etsy'nin refresh token'ları rotasyonlu, ikinci yenileme ilkini geçersiz kılabilir.
_token_locks_guard = _threading.Lock()
_token_locks: dict[int, _threading.Lock] = {}


def _lock_for_shop(shop_id: int) -> _threading.Lock:
    with _token_locks_guard:
        lock = _token_locks.get(shop_id)
        if lock is None:
            lock = _threading.Lock()
            _token_locks[shop_id] = lock
        return lock


MAX_RETRIES = 3
# 429: Etsy'nin oran sınırı — istek hiç işlenmedi, her zaman güvenle tekrar denenebilir.
# 5xx GET'lerde de tekrar denenir (okuma, yan etkisi yok); yazma isteklerinde (POST/PUT/DELETE) 5xx'te
# Etsy'nin isteği gerçekten işleyip işlemediği belirsiz olabileceğinden tekrar denenmez — hata olduğu gibi yükselir.
RETRYABLE_5XX = (500, 502, 503, 504)


def _retry_after_seconds(resp: httpx.Response, attempt: int) -> float:
    header = resp.headers.get("Retry-After")
    if header:
        try:
            return max(0.5, float(header))
        except ValueError:
            pass
    return 0.5 * (2**attempt)  # 0.5s, 1s, 2s



class EtsyAuthError(Exception):
    """No usable OAuth token for this shop (not connected, or refresh failed)."""


class EtsyApiError(Exception):
    """Etsy returned an HTTP error for an otherwise-authenticated request
    (bad input, pending app approval, rate limit, etc). Carries Etsy's own
    status code and error message so the frontend can show something useful
    instead of a generic 500."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class EtsyClient:
    """Authenticated Etsy API client bound to one shop's OAuth token.

    Every request the app makes to Etsy goes through this class so token
    refresh and error handling live in exactly one place.
    """

    def __init__(self, db: Session, shop: Shop):
        self.db = db
        self.shop = shop

    def _token(self) -> OAuthToken:
        token = self.shop.oauth_token
        if token is None:
            raise EtsyAuthError("Bu mağaza Etsy'ye bağlı değil.")

        if token.expires_at <= dt.datetime.utcnow() + dt.timedelta(minutes=2):
            with _lock_for_shop(self.shop.id):
                # Kilidi beklerken başka bir iş parçacığı (kendi session'ında) zaten yenilemiş olabilir —
                # DB'den taze oku, hâlâ süresi dolmak üzereyse biz yenileriz.
                self.db.refresh(token)
                if token.expires_at <= dt.datetime.utcnow() + dt.timedelta(minutes=2):
                    token_set = etsy_oauth.refresh_token_set(token.refresh_token)
                    token.access_token = token_set.access_token
                    token.refresh_token = token_set.refresh_token
                    token.expires_at = dt.datetime.utcnow() + dt.timedelta(seconds=token_set.expires_in)
                    self.db.commit()

        return token

    def _headers(self) -> dict:
        token = self._token()
        return {
            "x-api-key": f"{settings.etsy_api_key}:{settings.etsy_shared_secret}",
            "Authorization": f"Bearer {token.access_token}",
        }

    def request(self, method: str, path: str, **kwargs) -> Any:
        if isinstance(kwargs.get("data"), dict):
            kwargs["data"] = encode_form(kwargs["data"])

        for attempt in range(MAX_RETRIES + 1):
            rate_limit.throttle()
            try:
                resp = httpx.request(method, f"{API_BASE}{path}", headers=self._headers(), timeout=30, **kwargs)
            except httpx.RequestError as exc:
                if attempt < MAX_RETRIES:
                    _log.warning("Etsy %s %s ağ hatası (%s), tekrar denenecek (%s/%s)", method, path, exc, attempt + 1, MAX_RETRIES)
                    _time.sleep(0.5 * (2**attempt))
                    continue
                raise EtsyApiError(0, f"Etsy'ye bağlanılamadı: {exc}") from exc

            # Okumalar sessiz; Etsy'yi değiştiren (yazma) istekler ve tüm hatalar loglanır.
            if method != "GET":
                _writes.n = write_count() + 1
            if method != "GET" or resp.is_error:
                _log.info("Etsy %s %s -> %s", method, path, resp.status_code)

            if resp.is_error:
                # 429 her zaman (istek hiç işlenmedi); 5xx yalnızca GET'te (yan etkisiz) tekrar denenir —
                # yazma isteklerinde 5xx'te Etsy'nin isteği işleyip işlemediği belirsiz olabileceğinden denenmez.
                retryable = resp.status_code == 429 or (method == "GET" and resp.status_code in RETRYABLE_5XX)
                if retryable and attempt < MAX_RETRIES:
                    wait = _retry_after_seconds(resp, attempt)
                    _log.warning("Etsy %s %s -> %s, %.1fs sonra tekrar denenecek (%s/%s)", method, path, resp.status_code, wait, attempt + 1, MAX_RETRIES)
                    _time.sleep(wait)
                    continue
                _log.warning("Etsy hata: %s", _extract_error_message(resp)[:300])
                raise EtsyApiError(resp.status_code, _extract_error_message(resp))

            return resp.json() if resp.content else None


# Etsy form-encoded (application/x-www-form-urlencoded) gövdelerde dizileri VİRGÜLLE AYRILMIŞ tek metin olarak bekler
# (belge: tags = "A comma-separated list of tag strings"). httpx listeyi tekrarlanan alanlar olarak (tags=a&tags=b…)
# gönderirse Etsy YALNIZCA SONUNCUYU alır: 13 etiketten 12'si sessizce kaybolur. Bu yüzden listeleri burada birleştiriyoruz.
COMMA_FIELDS = {"tags", "materials", "style", "image_ids", "production_partner_ids", "value_ids", "values"}


def encode_form(data: dict) -> dict:
    out: dict = {}
    for key, value in data.items():
        if key in COMMA_FIELDS and isinstance(value, (list, tuple)):
            items = [str(v) for v in value]
            if not items:
                continue  # boş liste: alan hiç gönderilmez (eski davranış)
            if any("," in i for i in items):
                out[key] = list(value)  # virgül içeren değer birleştirilemez; nadir, olduğu gibi bırak
                _log.warning("Etsy form alanı %s virgül içeren değer taşıyor; birleştirilmedi", key)
                continue
            out[key] = ",".join(items)
        else:
            out[key] = value
    return out


def _extract_error_message(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        return body.get("error") or body.get("error_description") or resp.text
    except ValueError:
        return resp.text or f"Etsy API hatası ({resp.status_code})"

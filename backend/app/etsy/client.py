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

_log = _logging.getLogger("etsy")
_writes = _threading.local()  # istek başına (iş parçacığı başına) Etsy yazma sayacı


def write_count() -> int:
    return getattr(_writes, "n", 0)



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
        rate_limit.throttle()
        resp = httpx.request(method, f"{API_BASE}{path}", headers=self._headers(), timeout=30, **kwargs)
        # Okumalar sessiz; Etsy'yi değiştiren (yazma) istekler ve tüm hatalar loglanır.
        if method != "GET":
            _writes.n = write_count() + 1
        if method != "GET" or resp.is_error:
            _log.info("Etsy %s %s -> %s", method, path, resp.status_code)
        if resp.is_error:
            _log.warning("Etsy hata: %s", _extract_error_message(resp)[:300])
            raise EtsyApiError(resp.status_code, _extract_error_message(resp))
        return resp.json() if resp.content else None


def _extract_error_message(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        return body.get("error") or body.get("error_description") or resp.text
    except ValueError:
        return resp.text or f"Etsy API hatası ({resp.status_code})"

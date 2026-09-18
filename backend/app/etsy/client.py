import datetime as dt
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.etsy import oauth as etsy_oauth
from app.shops.models import OAuthToken, Shop

API_BASE = "https://api.etsy.com/v3/application"


class EtsyAuthError(Exception):
    pass


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
        resp = httpx.request(method, f"{API_BASE}{path}", headers=self._headers(), timeout=30, **kwargs)
        resp.raise_for_status()
        return resp.json() if resp.content else None

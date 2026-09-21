import base64
import hashlib
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.core.config import settings

AUTHORIZE_URL = "https://www.etsy.com/oauth/connect"
TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token"

# listings_* for the SEO loop, transactions_* for order sync, shops_r for
# shipping profiles/return policies (listing editor dropdowns) — requesting
# all of them now avoids forcing a second Etsy re-authorization later.
SCOPES = "listings_r listings_w transactions_r transactions_w shops_r"


@dataclass
class PkcePair:
    code_verifier: str
    code_challenge: str


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str
    expires_in: int


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def generate_pkce() -> PkcePair:
    verifier = _b64url(secrets.token_bytes(40))
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    return PkcePair(verifier, challenge)


def build_authorize_url(state: str, code_challenge: str) -> str:
    params = {
        "response_type": "code",
        "client_id": settings.etsy_api_key,
        "redirect_uri": settings.etsy_redirect_uri,
        "scope": SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code(code: str, code_verifier: str) -> TokenSet:
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "client_id": settings.etsy_api_key,
            "redirect_uri": settings.etsy_redirect_uri,
            "code": code,
            "code_verifier": code_verifier,
        },
    )
    resp.raise_for_status()
    payload = resp.json()
    return TokenSet(payload["access_token"], payload["refresh_token"], payload["expires_in"])


def refresh_token_set(refresh_token: str) -> TokenSet:
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "client_id": settings.etsy_api_key,
            "refresh_token": refresh_token,
        },
    )
    resp.raise_for_status()
    payload = resp.json()
    return TokenSet(payload["access_token"], payload["refresh_token"], payload["expires_in"])

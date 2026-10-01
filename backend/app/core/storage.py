"""Supabase Storage (özel kovalar) için ince istemci. Yalnızca backend, secret key ile kullanır; dosyalara dışarıdan
doğrudan erişilemez, görüntüleme için kısa ömürlü imzalı adres üretilir."""
import logging

import httpx

from app.core.config import settings

log = logging.getLogger("app.storage")
_ready_buckets: set[str] = set()


def _base() -> str:
    return f"{settings.supabase_url.rstrip('/')}/storage/v1"


def _headers() -> dict[str, str]:
    return {"apikey": settings.supabase_secret_key, "Authorization": f"Bearer {settings.supabase_secret_key}"}


def ensure_bucket(bucket: str, max_bytes: int) -> None:
    if bucket in _ready_buckets:
        return
    resp = httpx.post(
        f"{_base()}/bucket",
        headers=_headers(),
        json={"id": bucket, "name": bucket, "public": False, "file_size_limit": max_bytes},
        timeout=20,
    )
    if resp.status_code not in (200, 201, 400, 409):  # kova zaten varsa Supabase 400/409 döner
        resp.raise_for_status()
    _ready_buckets.add(bucket)


def upload(bucket: str, path: str, content: bytes, content_type: str) -> None:
    resp = httpx.post(
        f"{_base()}/object/{bucket}/{path}",
        headers={**_headers(), "Content-Type": content_type, "x-upsert": "false"},
        content=content,
        timeout=60,
    )
    resp.raise_for_status()


def signed_url(bucket: str, path: str, expires_in: int = 300) -> str:
    resp = httpx.post(f"{_base()}/object/sign/{bucket}/{path}", headers=_headers(), json={"expiresIn": expires_in}, timeout=20)
    resp.raise_for_status()
    return f"{settings.supabase_url.rstrip('/')}/storage/v1{resp.json()['signedURL']}"

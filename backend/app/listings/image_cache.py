"""Etsy görsellerinin yerel önbelleği. Senkronizasyonda bir kez indirilir; düzenleme ekranı
ve kırpıcı bundan sonra Etsy'ye hiç istek atmadan diskten okur."""

import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

IMAGE_CACHE_DIR = Path(__file__).resolve().parents[2] / "uploads" / "image-cache"


def _paths(shop_id: int, listing_id: int, image_id: int) -> tuple[Path, Path]:
    d = IMAGE_CACHE_DIR / str(shop_id) / str(listing_id)
    return d / f"{image_id}.bin", d / f"{image_id}.type"


def read(shop_id: int, listing_id: int, image_id: int) -> tuple[bytes, str] | None:
    data, kind = _paths(shop_id, listing_id, image_id)
    if data.exists() and kind.exists():
        return data.read_bytes(), kind.read_text(encoding="ascii")
    return None


def fetch(shop_id: int, listing_id: int, image_id: int, url: str) -> tuple[bytes, str]:
    resp = httpx.get(url, timeout=60)
    resp.raise_for_status()
    media_type = resp.headers.get("content-type", "image/jpeg").split(";", 1)[0]
    data, kind = _paths(shop_id, listing_id, image_id)
    data.parent.mkdir(parents=True, exist_ok=True)
    data.write_bytes(resp.content)
    kind.write_text(media_type, encoding="ascii")
    return resp.content, media_type


def cache_listing_images(shop_id: int, listing_id: int, images: list[dict]) -> None:
    """Listing'in henüz önbellekte olmayan görsellerini indirir (hata olursa atlar)."""
    for img in images:
        image_id = img.get("listing_image_id")
        url = img.get("url_fullxfull") or img.get("url_570xN")
        if not image_id or not url or read(shop_id, listing_id, image_id) is not None:
            continue
        try:
            fetch(shop_id, listing_id, image_id, url)
        except Exception:
            logger.warning("Image %s of listing %s could not be cached", image_id, listing_id)

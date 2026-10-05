"""Banner üretimi, kırpma ve saklama.

- generate: seçilen ilanların ilk fotoğrafları referans olarak modele verilir, görsel stilin oranında üretilir ve tam
  ölçüye getirilir (yapay zekâ; kredi ve istek sınırı router'daki require_ai_enabled ile uygulanır).
- crop_tile: collage karesi için ilanın ilk fotoğrafını kareye kırpar (yapay zekâ yok, ücretsiz).
Fotoğraf adresleri yalnızca mağazanın kendi ilan önbelleğinden okunur (kullanıcının verdiği adres çekilmez)."""
import datetime as dt
import io
import json
import logging
import uuid

import httpx
from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import image_gen
from app.banners import prompts
from app.banners.models import BannerImage
from app.banners.styles import SEASONS, STYLES, Style
from app.core import blobstore
from app.core.i18n import tr
from app.listings.models import ListingCache
from app.shops.models import Shop

log = logging.getLogger(__name__)

MAX_PRODUCTS = 10
RETENTION = dt.timedelta(days=30)
TEXT_MAX = 80


class BannerError(ValueError):
    """Kullanıcıya gösterilecek anlaşılır hata."""


def _style(key: str) -> Style:
    style = STYLES.get(key)
    if style is None:
        raise BannerError(tr("Bilinmeyen banner stili.", "Unknown banner style."))
    return style


def _first_image(db: Session, shop: Shop, listing_id: int, size: str) -> tuple[bytes, str] | None:
    row = db.scalar(select(ListingCache).where(ListingCache.shop_id == shop.id, ListingCache.listing_id == listing_id))
    if row is None:
        return None
    images = sorted(json.loads(row.raw_json).get("images") or [], key=lambda i: i.get("rank") or 0)
    url = (images[0].get(size) or images[0].get("url_570xN")) if images else None
    if not url:
        return None
    try:
        resp = httpx.get(url, timeout=20, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError:
        log.warning("Banner: ilan %s fotoğrafı indirilemedi", listing_id, exc_info=True)
        return None
    return resp.content, resp.headers.get("content-type", "image/jpeg").split(";")[0]


def _finalize(data: bytes, style: Style) -> bytes:
    """Ortadan hedef orana kırpar ve tam ölçüye getirir (JPEG)."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    w, h = img.size
    tw, th = style.size
    target = tw / th
    if w / h > target:  # fazla geniş: yanlardan
        nw = round(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    elif w / h < target:  # fazla yüksek: üstten/alttan
        nh = round(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    img = img.resize(style.size, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90, optimize=True)
    return buf.getvalue()


def _save(db: Session, shop: Shop, user_id: int | None, style: Style, slot: int, data: bytes) -> BannerImage:
    image_id = str(uuid.uuid4())
    path = blobstore.put(f"banners/{shop.id}/{image_id}.jpg", data, "image/jpeg")
    row = BannerImage(id=image_id, shop_id=shop.id, user_id=user_id, style=style.key, slot=slot, width=style.size[0], height=style.size[1], path=path)
    db.add(row)
    db.commit()
    return row


def generate(
    db: Session, shop: Shop, user_id: int | None, *, style_key: str, slot: int, slots: int, listing_ids: list[int],
    season: str | None, scene: str, headline: str, subline: str,
) -> BannerImage:
    style = _style(style_key)
    if not style.min_slots <= slots <= style.max_slots or not 0 <= slot < slots:
        raise BannerError(tr("Görsel sayısı bu stile uymuyor.", "The number of images does not fit this style."))
    if season and season not in SEASONS:
        raise BannerError(tr("Bilinmeyen tema.", "Unknown theme."))
    ids = list(dict.fromkeys(listing_ids))[:MAX_PRODUCTS]
    if style.key == "collage":
        ids = ids[slot:slot + 1]  # her kare kendi ilanını gösterir
    refs = [r for r in (_first_image(db, shop, lid, "url_570xN") for lid in ids) if r]
    if not refs and not (season or scene.strip()):
        raise BannerError(tr("En az bir ilan seç ya da bir tema/tarif yaz.", "Pick at least one listing or enter a theme or description."))
    prompt = prompts.build(
        style, n_products=len(refs), season=season, scene=scene[:500], headline=headline[:TEXT_MAX], subline=subline[:TEXT_MAX], slot=slot, slots=slots,
    )
    data, _mime = image_gen.generate_with_references(prompt, refs, style.ratio)
    return _save(db, shop, user_id, style, slot, _finalize(data, style))


def crop_tile(db: Session, shop: Shop, user_id: int | None, *, listing_id: int, slot: int) -> BannerImage:
    """Collage karesi: ilanın ilk fotoğrafını kareye kırpar (yapay zekâ yok)."""
    style = STYLES["collage"]
    if not 0 <= slot < style.max_slots:
        raise BannerError(tr("Görsel sayısı bu stile uymuyor.", "The number of images does not fit this style."))
    found = _first_image(db, shop, listing_id, "url_fullxfull")
    if found is None:
        raise BannerError(tr("Bu ilanın fotoğrafı alınamadı.", "This listing's photo could not be loaded."))
    return _save(db, shop, user_id, style, slot, _finalize(found[0], style))


def get(db: Session, shop: Shop, image_id: str) -> BannerImage | None:
    row = db.get(BannerImage, image_id)
    return row if row is not None and row.shop_id == shop.id else None


def recent(db: Session, shop: Shop, limit: int = 24) -> list[BannerImage]:
    return list(db.scalars(select(BannerImage).where(BannerImage.shop_id == shop.id).order_by(BannerImage.created_at.desc()).limit(limit)))


def _delete(db: Session, rows: list[BannerImage]) -> int:
    paths = [r.path for r in rows]
    for r in rows:
        db.delete(r)
    db.commit()
    blobstore.remove(paths)
    return len(rows)


def purge_shop(db: Session, shop_id: int) -> None:
    _delete(db, list(db.scalars(select(BannerImage).where(BannerImage.shop_id == shop_id))))


def purge_expired(db: Session, now: dt.datetime | None = None) -> int:
    cutoff = (now or dt.datetime.utcnow()) - RETENTION
    n = _delete(db, list(db.scalars(select(BannerImage).where(BannerImage.created_at < cutoff).limit(500))))
    if n:
        log.info("%s gün eski %s banner görseli silindi", RETENTION.days, n)
    return n


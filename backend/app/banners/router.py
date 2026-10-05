from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.image_gen import ImageGenError
from app.auth.models import User
from app.banners import service
from app.banners.models import BannerImage
from app.core import blobstore
from app.core.db import get_db
from app.core.deps import get_current_user
from app.shops.deps import get_owned_shop, require_ai_enabled
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/banners", tags=["banners"])


def _out(row: BannerImage, shop_id: int) -> dict:
    return {
        "id": row.id, "style": row.style, "slot": row.slot, "width": row.width, "height": row.height,
        "url": f"/api/shops/{shop_id}/banners/images/{row.id}", "created_at": row.created_at.isoformat(),
    }


class GenerateIn(BaseModel):
    style: str = Field(max_length=12)
    slot: int = Field(default=0, ge=0, le=3)
    slots: int = Field(default=1, ge=1, le=4)
    listing_ids: list[int] = Field(default_factory=list, max_length=service.MAX_PRODUCTS)
    season: str | None = Field(default=None, max_length=20)
    scene: str = Field(default="", max_length=500)
    headline: str = Field(default="", max_length=service.TEXT_MAX)
    subline: str = Field(default="", max_length=service.TEXT_MAX)


@router.post("/generate", dependencies=[Depends(require_ai_enabled)])
def generate(body: GenerateIn, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Bir banner görseli üretir (carousel'de her slayt ayrı istek: ilerleme ve tekrar üretme slayt slayt)."""
    try:
        row = service.generate(
            db, shop, user.id, style_key=body.style, slot=body.slot, slots=body.slots, listing_ids=body.listing_ids,
            season=body.season, scene=body.scene, headline=body.headline, subline=body.subline,
        )
    except service.BannerError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ImageGenError as exc:
        raise HTTPException(502, str(exc)) from exc
    return _out(row, shop.id)


class CropIn(BaseModel):
    listing_id: int
    slot: int = Field(default=0, ge=0, le=3)


@router.post("/crop")
def crop(body: CropIn, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Collage karesi: ilanın ilk fotoğrafını kareye kırpar (yapay zekâ yok, kredi harcamaz)."""
    try:
        return _out(service.crop_tile(db, shop, user.id, listing_id=body.listing_id, slot=body.slot), shop.id)
    except service.BannerError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/recent")
def recent(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return [_out(r, shop.id) for r in service.recent(db, shop)]


@router.get("/images/{image_id}")
def image(image_id: str, download: bool = False, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    row = service.get(db, shop, image_id)
    if row is None:
        raise HTTPException(404, "Görsel bulunamadı")
    try:
        content = blobstore.read(row.path)
    except FileNotFoundError:
        raise HTTPException(404, "Görsel bulunamadı")
    headers = {"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="banner-{row.style}-{row.slot + 1}-{row.width}x{row.height}.jpg"'
    return Response(content, media_type="image/jpeg", headers=headers)

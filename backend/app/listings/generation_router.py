"""Listing düzenleyicisindeki "Oluştur" penceresinin uç noktaları: seçilebilir modeller, görsel üretimi ve video işi."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai import catalog, video_gen
from app.ai.image_gen import ImageGenError
from app.auth.models import User
from app.billing import metering, settings as credit_settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.i18n import tr
from app.listings import generation
from app.listings.generation import InsufficientCredits, Reference
from app.shops.deps import get_owned_shop, require_ai_enabled
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/listings/{listing_id}/draft", tags=["listings"])


# ---- Seçenekler


@router.get("/generate/options", dependencies=[Depends(get_owned_shop)])
def generation_options(listing_id: int):
    return {
        "credits_enabled": credit_settings.enabled(),
        "image": generation.kind_options("image"),
        "video": generation.kind_options("video", generation.video_durations),
        "upscale": generation.upscale_options(),
    }


# ---- Görsel


class Choice(BaseModel):
    model_id: int | None = None  # katalog modeli; boşsa görevin modeli
    variant: str | None = Field(default=None, max_length=40)


class ReferenceIn(BaseModel):
    reference_draft_file_id: str | None = None
    # Listing'in kendi fotoğraflarından biri referans olarak (taslak fotoğrafsa dosyasıyla birlikte)
    reference_image_id: int | None = None
    reference_image_draft_file_id: str | None = None

    def reference(self) -> Reference:
        return Reference(self.reference_draft_file_id, self.reference_image_id, self.reference_image_draft_file_id)


class GenerateImageIn(Choice, ReferenceIn):
    prompt: str = Field(min_length=1, max_length=2000)


@router.post("/images/generate", dependencies=[Depends(require_ai_enabled)])
def generate_image(listing_id: int, payload: GenerateImageIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Kaynak fotoğraf olmadan (isteğe bağlı bir ürün referansıyla) yeni bir taslak fotoğrafı üretir."""
    try:
        return generation.generate_image(db, shop, listing_id, payload.prompt, payload.reference(), payload.model_id, payload.variant)
    except ImageGenError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


# ---- Video


class GenerateVideoIn(Choice, ReferenceIn):
    prompt: str = Field(min_length=1, max_length=2000)
    duration: int = Field(ge=1, le=60)


class VideoJobIn(BaseModel):
    job: str = Field(min_length=1, max_length=2000)


@router.post("/videos/generate", dependencies=[Depends(require_ai_enabled)])
def start_video(listing_id: int, payload: GenerateVideoIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Video üretimini başlatır; dönen `job` bileti `/videos/generate/status` ile sorulur."""
    try:
        return generation.start_video(db, shop, listing_id, payload.prompt, payload.duration, payload.reference(), payload.model_id, payload.variant)
    except InsufficientCredits as exc:
        raise HTTPException(
            402,
            tr(f"Bu video için {exc.needed} kredi gerekiyor; bakiyen yetmiyor.", f"This video needs {exc.needed} credits; your balance is not enough."),
        ) from exc
    except video_gen.VideoGenError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/videos/generate/status")
def video_status(
    listing_id: int, payload: VideoJobIn, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Video işinin durumu. Sık sorulduğu için AI istek sınırına sayılmaz; kredi, iş başlarken kontrol edildi ve video
    kaydedilirken (bir kez) düşülür."""
    try:
        with metering.bind(metering.Scope(shop.workspace_id, user.id)):
            return generation.poll_video(db, shop, listing_id, payload.job)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except video_gen.VideoGenError as exc:
        raise HTTPException(502, str(exc)) from exc

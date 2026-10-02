import datetime as dt
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.uploads import MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, read_limited
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core import blobstore
from app.core.db import get_db
from app.core.deps import get_current_user
from app.etsy.client import EtsyAuthError
from app.listings import bulk, creation, drafts, health, performance, service
from app.listings.schemas import (
    DraftSaveIn,
    ImageOrderIn,
    InventoryUpdateIn,
    ListingEditOut,
    ListingHealthOut,
    ListingHistoryOut,
    ListingOut,
    ListingUpdateIn,
    PersonalizationIn,
    PersonalizationOut,
    PropertyUpdateIn,
    SuggestIn,
    SuggestionOut,
    VariationImagesIn,
)
from app.shops.deps import get_owned_shop, require_ai_enabled
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/listings", tags=["listings"])


@router.get("", response_model=list[ListingOut])
def get_listings(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.list_listings(db, shop)


@router.get("/top-categories")
def top_categories(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Mağazanın listing'lerinde en çok kullanılan kategoriler (yerel önbellekten, Etsy'ye istek yok)."""
    return service.get_top_categories(db, shop)


class NewListingIn(BaseModel):
    source_listing_id: int | None = None


@router.post("/new")
def new_listing(payload: NewListingIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Yerelde yeni listing (boş ya da var olan bir listing'in kopyası). Etsy'ye "Yayınla" ile gider."""
    try:
        return creation.create_local_new(db, shop, payload.source_listing_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/bulk-stage")
def bulk_stage(payload: bulk.BulkStageIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Toplu değişiklikleri seçili listing'lerin yerel sürümüne işler (Etsy'ye gitmez)."""
    return bulk.bulk_stage(db, shop, payload)


@router.delete("/{listing_id}")
def delete_listing(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Listing'i Etsy'den KALICI siler (geri alınamaz)."""
    try:
        bulk.delete_listing(db, shop, listing_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    return {"ok": True}


@router.get("/personalization-library")
def personalization_library(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.get_personalization_library(db, shop)


@router.get("/sync-status")
def sync_status(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.get_sync_status(db, shop)


@router.post("/sync", status_code=202)
def sync(full: bool = False, shop: Shop = Depends(get_owned_shop)):
    """Fire-and-forget — a full sync can take minutes for a large shop (every
    listing's inventory + properties, paced by the shared Etsy rate limiter),
    so this starts it in the background and returns immediately. Poll
    GET /sync-status to know when it's done."""
    started = service.start_background_sync(shop, full=full)
    return {"syncing": True, "started": started}


def _health_out(h) -> ListingHealthOut:
    return ListingHealthOut(
        listing_id=h.listing_id,
        stage=h.stage,
        bottleneck=h.bottleneck,
        note=h.note,
        attempts=h.attempts,
        window_start=h.window_start.isoformat() if h.window_start else None,
        evaluated_at=h.evaluated_at.isoformat() if h.evaluated_at else None,
        killed_at=h.killed_at.isoformat() if h.killed_at else None,
    )


@router.get("/health", response_model=list[ListingHealthOut])
def shop_health(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Mağazadaki tüm listing'lerin optimizasyon/durdurma durumu (liste sayfası rozetleri için)."""
    return [_health_out(h) for h in health.get_shop_health(db, shop)]


@router.get("/{listing_id}/health", response_model=ListingHealthOut | None)
def listing_health(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    h = health.get_listing_health(db, shop, listing_id)
    return _health_out(h) if h else None


@router.post("/{listing_id}/health/kill", response_model=ListingHealthOut)
def kill_listing(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Kullanıcı onayıyla listing'i Etsy'de inactive yapar (geri alınabilir)."""
    try:
        return _health_out(health.kill_listing(db, shop, listing_id))
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.post("/{listing_id}/health/keep-watching", response_model=ListingHealthOut)
def keep_watching_listing(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Kullanıcı 'durdurma' önerisini reddetti; sayaç sıfırlanır, yeni bir gözlem penceresi başlar."""
    try:
        return _health_out(health.keep_watching(db, shop, listing_id))
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/{listing_id}/performance")
def listing_performance(
    listing_id: int,
    start: dt.date | None = None,
    end: dt.date | None = None,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    """Dönem performansı: satış (geriye dönük tam), görüntülenme/favori artışı (günlük anlık görüntülerden), içerik tazeliği."""
    today = dt.date.today()
    end = end or today
    start = start or end - dt.timedelta(days=89)
    data = performance.listing_performance(db, shop, listing_id, start, end)
    if data is None:
        raise HTTPException(404, "Listing yerelde bulunamadı")
    return data


@router.get("/{listing_id}/history", response_model=ListingHistoryOut)
def history(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.get_listing_history(db, shop, listing_id)


@router.get("/{listing_id}/edit", response_model=ListingEditOut)
def get_edit(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        return service.get_listing_for_edit(db, shop, listing_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.put("/{listing_id}", response_model=ListingEditOut)
def update_fields(
    listing_id: int,
    payload: ListingUpdateIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        return service.update_listing_fields(db, shop, user.id, listing_id, payload)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.put("/{listing_id}/properties/{property_id}")
def update_property(
    listing_id: int,
    property_id: int,
    payload: PropertyUpdateIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        return service.update_listing_property(db, shop, listing_id, property_id, payload)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.delete("/{listing_id}/properties/{property_id}")
def delete_property(
    listing_id: int,
    property_id: int,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        service.delete_listing_property(db, shop, listing_id, property_id)
        return {"ok": True}
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{listing_id}/draft")
def get_draft(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return drafts.get_draft(db, shop, listing_id)


@router.put("/{listing_id}/draft")
def save_draft(
    listing_id: int,
    payload: DraftSaveIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    return drafts.save_draft(db, shop, listing_id, payload.data)


@router.delete("/{listing_id}/draft")
def discard_draft(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    drafts.discard_draft(db, shop, listing_id)
    return {"ok": True}


@router.post("/{listing_id}/draft/files")
async def upload_draft_file(
    listing_id: int,
    file: UploadFile = File(...),
    kind: str = Form(...),
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    if kind not in ("image", "video"):
        raise HTTPException(400, "kind image veya video olmalı")
    content = await read_limited(file, MAX_VIDEO_BYTES if kind == "video" else MAX_IMAGE_BYTES, "Dosya")
    return drafts.save_file(
        db, shop, listing_id, kind, file.filename or f"{kind}", file.content_type or "", content
    )


class AltTextIn(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=10)
    title: str = ""


@router.post("/{listing_id}/draft/alt-text", dependencies=[Depends(require_ai_enabled)])
def generate_alt_text(listing_id: int, payload: AltTextIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Taslak (henüz Etsy'ye yüklenmemiş) fotoğraflar için yapay zekâ ile alt metin önerir. Etsy'ye istek atmaz;
    Etsy API'si alt metni yalnızca fotoğraf yüklenirken kabul eder, mevcut fotoğrafların alt metni değiştirilemez."""
    from app.ai import vision

    files = []
    for fid in payload.file_ids:
        f = drafts.get_file(db, shop, listing_id, fid)
        if f is None or f.kind != "image":
            raise HTTPException(404, "Taslak fotoğraf bulunamadı")
        files.append(f)
    try:
        texts = vision.generate_alt_texts([{"path": f.path, "content_type": f.content_type} for f in files], payload.title)
    except vision.VisionError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"alt_texts": {f.id: t for f, t in zip(files, texts)}}


class RegenerateImageIn(BaseModel):
    image_id: int
    draft_file_id: str | None = None
    prompt: str | None = None
    reference_draft_file_id: str | None = None
    # Kamera açısı küpü / mesafe seçiciden gelen hazır cümleler — sahne talimatından (prompt) AYRI, kendi
    # öncelikli talimat katmanları olarak modele gider (bkz. ai/image_gen.py _build_prompt).
    camera_prompt: str | None = None
    distance_prompt: str | None = None
    # Sahnede birden fazla obje olduğunda "ürün bu" diye işaret eden ayrı referans (listing'in kendi
    # fotoğraflarından biri, id>0 Etsy'de yayında / id<0 henüz taslak).
    subject_image_id: int | None = None
    subject_draft_file_id: str | None = None


@router.get("/{listing_id}/draft/images/{image_id}/versions")
def draft_image_versions(
    listing_id: int,
    image_id: int,
    draft_file_id: str | None = None,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    """Bir fotoğraf yuvasının tüm geçmişi (orijinal + üretilen her sürüm) — küpün yanındaki sürüm noktaları için."""
    return {"versions": drafts.list_versions(db, shop, listing_id, image_id, draft_file_id)}


@router.post("/{listing_id}/draft/images/regenerate", dependencies=[Depends(require_ai_enabled)])
def regenerate_draft_image(
    listing_id: int,
    payload: RegenerateImageIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    """Sihirli değnek: tek bir görseli Gemini ile yeniden oluşturur. Toplu düzenleme, frontend'in bu aynı
    uç noktayı seçilen her görsel için sırayla çağırmasıyla yapılır — davranış ikisinde de birebir aynıdır."""
    from app.ai.image_gen import ImageGenError

    try:
        return drafts.regenerate_image(
            db, shop, listing_id, payload.image_id, payload.draft_file_id, payload.prompt,
            payload.reference_draft_file_id, payload.camera_prompt, payload.distance_prompt,
            payload.subject_image_id, payload.subject_draft_file_id,
        )
    except ImageGenError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class GenerateImageIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    reference_draft_file_id: str | None = None


@router.post("/{listing_id}/draft/images/generate", dependencies=[Depends(require_ai_enabled)])
def generate_draft_image(
    listing_id: int,
    payload: GenerateImageIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    """AI ile oluştur: kaynak fotoğraf olmadan, yalnızca yazılan talimattan yeni bir taslak fotoğrafı üretir."""
    from app.ai.image_gen import ImageGenError

    try:
        return drafts.generate_image_from_prompt(db, shop, listing_id, payload.prompt, payload.reference_draft_file_id)
    except ImageGenError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.get("/{listing_id}/draft/files/{file_id}")
def get_draft_file(
    listing_id: int,
    file_id: str,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    f = drafts.get_file(db, shop, listing_id, file_id)
    if f is None:
        raise HTTPException(404, "Dosya bulunamadı")
    try:
        content = blobstore.read(f.path)
    except FileNotFoundError:
        raise HTTPException(404, "Dosya bulunamadı")
    # Dosya kimliği değişmez (yeni sürüm yeni kimlik alır): tarayıcı uzun süre önbellekte tutabilir.
    return Response(content, media_type=f.content_type, headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})


@router.get("/{listing_id}/local")
def get_local(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return drafts.get_local(db, shop, listing_id)


@router.put("/{listing_id}/local")
def save_local(
    listing_id: int,
    payload: DraftSaveIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    return drafts.save_local(db, shop, listing_id, payload.data, payload.base)


@router.delete("/{listing_id}/local")
def discard_local(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    drafts.discard_local(db, shop, listing_id)
    return {"ok": True}


@router.post("/{listing_id}/local/publish")
def publish_local(
    listing_id: int,
    force: bool = False,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """force=true: Etsy'de sonradan değişen alanlar da yerel kopyayla ezilir (çakışma onaylandıktan sonra)."""
    try:
        return drafts.publish_local(db, shop, user.id, listing_id, force)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.put("/{listing_id}/inventory")
def update_inventory(
    listing_id: int,
    payload: InventoryUpdateIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        return service.update_listing_inventory(db, shop, listing_id, payload)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{listing_id}/variation-images")
def get_variation_images(
    listing_id: int,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        return service.get_variation_images(db, shop, listing_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.post("/{listing_id}/variation-images")
def update_variation_images(
    listing_id: int,
    payload: VariationImagesIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        return service.update_variation_images(db, shop, listing_id, payload)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.post("/{listing_id}/images")
async def upload_image(
    listing_id: int,
    image: UploadFile = File(...),
    rank: int | None = Form(default=None),
    alt_text: str | None = Form(default=None),
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        content = await read_limited(image, MAX_IMAGE_BYTES, "Görsel")
        return service.upload_listing_image(
            db, shop, listing_id, content, image.filename or "image.jpg", rank, alt_text
        )
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.put("/{listing_id}/images/order")
def reorder_images(
    listing_id: int,
    payload: ImageOrderIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        return service.reorder_listing_images(db, shop, listing_id, payload)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{listing_id}/images/{image_id}/file")
def get_image_file(
    listing_id: int,
    image_id: int,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        content, media_type = drafts.download_image(db, shop, listing_id, image_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return Response(content, media_type=media_type, headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/{listing_id}/images/{image_id}")
def delete_image(
    listing_id: int,
    image_id: int,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        service.delete_listing_image(db, shop, listing_id, image_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    return {"ok": True}


@router.post("/{listing_id}/videos")
async def upload_video(
    listing_id: int,
    video: UploadFile = File(...),
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        content = await read_limited(video, MAX_VIDEO_BYTES, "Video")
        return service.upload_listing_video(db, shop, listing_id, content, video.filename or "video.mp4")
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.delete("/{listing_id}/videos/{video_id}")
def delete_video(
    listing_id: int,
    video_id: int,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        service.delete_listing_video(db, shop, listing_id, video_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    return {"ok": True}


@router.get("/{listing_id}/personalization", response_model=PersonalizationOut)
def get_personalization(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.get_listing_personalization(db, shop, listing_id)


@router.put("/{listing_id}/personalization", response_model=PersonalizationOut)
def update_personalization(
    listing_id: int,
    payload: PersonalizationIn,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    try:
        return service.update_listing_personalization(db, shop, listing_id, payload)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.post("/{listing_id}/suggest", response_model=SuggestionOut, dependencies=[Depends(require_ai_enabled)])
def suggest(
    listing_id: int,
    payload: SuggestIn | None = None,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        return service.create_suggestion(db, shop, user.id, listing_id, payload)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    except service.SuggestionError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/suggestions/{suggestion_id}/apply", response_model=SuggestionOut)
def apply(suggestion_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        return service.apply_suggestion(db, shop, suggestion_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    except service.SuggestionNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except service.SuggestionConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/suggestions/{suggestion_id}/dismiss", response_model=SuggestionOut)
def dismiss(suggestion_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        return service.dismiss_suggestion(db, shop, suggestion_id)
    except service.SuggestionNotFound as exc:
        raise HTTPException(404, str(exc)) from exc

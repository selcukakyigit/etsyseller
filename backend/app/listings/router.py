from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.db import get_db
from app.core.deps import get_current_user
from app.etsy.client import EtsyAuthError
from app.listings import drafts, service
from app.listings.schemas import (
    DraftSaveIn,
    ImageOrderIn,
    InventoryUpdateIn,
    ListingEditOut,
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
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/listings", tags=["listings"])


@router.get("", response_model=list[ListingOut])
def get_listings(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.list_listings(db, shop)


@router.get("/top-categories")
def top_categories(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Mağazanın listing'lerinde en çok kullanılan kategoriler (yerel önbellekten, Etsy'ye istek yok)."""
    return service.get_top_categories(db, shop)


@router.get("/sync-status")
def sync_status(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.get_sync_status(db, shop)


@router.post("/sync", status_code=202)
def sync(shop: Shop = Depends(get_owned_shop)):
    """Fire-and-forget — a full sync can take minutes for a large shop (every
    listing's inventory + properties, paced by the shared Etsy rate limiter),
    so this starts it in the background and returns immediately. Poll
    GET /sync-status to know when it's done."""
    started = service.start_background_sync(shop)
    return {"syncing": True, "started": started}


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
    content = await file.read()
    return drafts.save_file(
        db, shop, listing_id, kind, file.filename or f"{kind}", file.content_type or "", content
    )


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
    return FileResponse(f.path, media_type=f.content_type, filename=f.filename)


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
    return drafts.save_local(db, shop, listing_id, payload.data)


@router.delete("/{listing_id}/local")
def discard_local(listing_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    drafts.discard_local(db, shop, listing_id)
    return {"ok": True}


@router.post("/{listing_id}/local/publish")
def publish_local(
    listing_id: int,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        return drafts.publish_local(db, shop, user.id, listing_id)
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
        content = await image.read()
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
        content = await video.read()
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


@router.post("/{listing_id}/suggest", response_model=SuggestionOut)
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

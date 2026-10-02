import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.assistant import llm, service
from app.auth.models import User
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.shops.deps import get_owned_shop, require_ai_enabled
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/assistant", tags=["assistant"])


class ChatIn(BaseModel):
    message: str = Field(default="", max_length=8000)
    session_id: int | None = None
    image_ids: list[str] = Field(default_factory=list, max_length=service.MAX_IMAGES_PER_MESSAGE)
    provider: str | None = None
    today: dt.date | None = None  # istemcinin yerel tarihi
    request_id: str | None = Field(default=None, max_length=64)  # ilerleme takibi için
    lang: str = Field(default="tr", pattern="^(tr|en)$")  # arayüz dili; asistan bu dilde cevap verir


@router.get("/providers")
def providers(shop: Shop = Depends(get_owned_shop)):
    return {"default": settings.ai_provider, "providers": llm.available_providers()}


@router.post("/chat", dependencies=[Depends(require_ai_enabled)])
def chat(body: ChatIn, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return service.chat(db, shop, user.id, body.session_id, body.message, body.image_ids, body.provider, body.today or dt.date.today(), body.request_id, body.lang)
    except llm.AssistantError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/progress/{request_id}")
def progress(request_id: str, shop: Shop = Depends(get_owned_shop)):
    """Asistanın o an yaptığı işin kısa açıklaması (arayüz bekleme sırasında gösterir)."""
    return {"step": service.get_progress(shop.id, request_id)}


@router.get("/sessions")
def sessions(shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.list_sessions(db, shop, user.id)


@router.get("/sessions/{session_id}")
def session(session_id: int, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    data = service.get_session(db, shop, user.id, session_id)
    if data is None:
        raise HTTPException(404, "Sohbet bulunamadı")
    return data


class BulkDeleteIn(BaseModel):
    ids: list[int] | None = None  # None = tüm sohbetler
    all: bool = False


@router.post("/sessions/bulk-delete")
def bulk_delete(body: BulkDeleteIn, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.all and not body.ids:
        raise HTTPException(400, "Silinecek sohbet seçilmedi")
    return {"deleted": service.delete_sessions(db, shop, user.id, None if body.all else body.ids)}


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not service.delete_session(db, shop, user.id, session_id):
        raise HTTPException(404, "Sohbet bulunamadı")
    return {"ok": True}


@router.post("/images")
async def upload_image(
    file: UploadFile = File(...),
    session_id: int | None = Form(default=None),
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
):
    content = await file.read(service.MAX_IMAGE_BYTES + 1)
    try:
        return service.save_image(db, shop, session_id, file.filename or "resim", file.content_type or "", content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/images/{image_id}")
def image(image_id: str, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    img = service.get_image(db, shop, image_id)
    if img is None:
        raise HTTPException(404, "Resim bulunamadı")
    return FileResponse(img.path, media_type=img.content_type, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"})


@router.get("/dashboard")
def dashboard(today: dt.date | None = None, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.dashboard(db, shop, today or dt.date.today())

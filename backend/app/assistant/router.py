import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.assistant import batch_drafts, llm, memory, service
from app.auth.models import User
from app.core import blobstore
from app.core.byte_range import ranged
from app.core.download import attachment
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.i18n import tr
from app.listings import rewrite
from app.shops.deps import get_owned_shop, require_ai_enabled
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/assistant", tags=["assistant"])


class ChatIn(BaseModel):
    message: str = Field(default="", max_length=8000)
    session_id: int | None = None
    image_ids: list[str] = Field(default_factory=list, max_length=service.MAX_IMAGES_PER_MESSAGE)
    today: dt.date | None = None  # istemcinin yerel tarihi
    request_id: str | None = Field(default=None, max_length=64)  # ilerleme takibi için
    lang: str = Field(default="tr", pattern="^(tr|en)$")  # arayüz dili; asistan bu dilde cevap verir


@router.post("/chat", dependencies=[Depends(require_ai_enabled)])
def chat(body: ChatIn, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return service.chat(db, shop, user.id, body.session_id, body.message, body.image_ids, body.today or dt.date.today(), body.request_id, body.lang)
    except llm.AssistantError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class AutofillAttributesIn(BaseModel):
    listing_id: int
    title: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=20000)
    tags: list[str] | None = Field(default=None, max_length=20)
    materials: list[str] | None = Field(default=None, max_length=30)
    properties: list[dict] | None = Field(default=None, max_length=100)
    today: dt.date | None = None


@router.post("/autofill-attributes", dependencies=[Depends(require_ai_enabled)])
def autofill_attributes(body: AutofillAttributesIn, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Editördeki AI önerisinden sonra kategori özelliklerini (malzeme, kullanım yeri…) doldurur; kaydetmez."""
    try:
        return service.autofill_attributes(db, shop, user.id, body.today or dt.date.today(), body.listing_id, body.model_dump(exclude={"listing_id", "today"}))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - listing yok, kategori yok, sağlayıcı hatası: düzenleyici öneriyi yine de uygular
        raise HTTPException(502, str(exc)[:300]) from exc


@router.get("/progress/{request_id}")
def progress(request_id: str, shop: Shop = Depends(get_owned_shop)):
    """Asistanın o an yaptığı işin kısa açıklaması (arayüz bekleme sırasında gösterir)."""
    return service.get_progress(shop.id, request_id)


def _rewrite_job(job_id: str, shop: Shop) -> rewrite.Job:
    job = rewrite.get(job_id, shop.id)
    if job is None:
        raise HTTPException(404, tr("İş bulunamadı (süresi dolmuş ya da sunucu yeniden başlamış olabilir). O ana dek yazılanlar yerel taslakta duruyor.", "Job not found (it may have expired or the server restarted). What was written so far stays in local drafts."))
    return job


@router.get("/rewrite-jobs/{job_id}")
def rewrite_job(job_id: str, shop: Shop = Depends(get_owned_shop)):
    return rewrite.public(_rewrite_job(job_id, shop))


@router.post("/rewrite-jobs/{job_id}/start", dependencies=[Depends(require_ai_enabled)])
def rewrite_job_start(job_id: str, shop: Shop = Depends(get_owned_shop)):
    job = _rewrite_job(job_id, shop)
    rewrite.start(job)
    return rewrite.public(job)


@router.post("/rewrite-jobs/{job_id}/stop")
def rewrite_job_stop(job_id: str, shop: Shop = Depends(get_owned_shop)):
    job = _rewrite_job(job_id, shop)
    rewrite.stop(job)
    return rewrite.public(job)


def _batch_job(job_id: str, shop: Shop) -> batch_drafts.Job:
    job = batch_drafts.get(job_id, shop.id)
    if job is None:
        raise HTTPException(404, tr("İş bulunamadı (süresi dolmuş ya da sunucu yeniden başlamış olabilir). O ana dek oluşan taslaklar yerelde duruyor.", "Job not found (it may have expired or the server restarted). The drafts made so far stay local."))
    return job


@router.get("/batch-jobs/{job_id}")
def batch_job(job_id: str, shop: Shop = Depends(get_owned_shop)):
    return batch_drafts.public(_batch_job(job_id, shop))


@router.post("/batch-jobs/{job_id}/stop")
def batch_job_stop(job_id: str, shop: Shop = Depends(get_owned_shop)):
    job = _batch_job(job_id, shop)
    batch_drafts.stop(job)
    return batch_drafts.public(job)


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
    content = await file.read(service.MAX_VIDEO_BYTES + 1)  # videolar 100 MB'a kadar; diğer dosyaların sınırı save_image'da
    try:
        return service.save_image(db, shop, session_id, file.filename or "resim", file.content_type or "", content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/images/{image_id}")
def delete_image(image_id: str, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    if not service.delete_image(db, shop, image_id):
        raise HTTPException(404, "Resim bulunamadı")
    return {"ok": True}


@router.get("/images/{image_id}")
def image(image_id: str, request: Request, download: bool = False, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    img = service.get_image(db, shop, image_id)
    if img is None:
        raise HTTPException(404, "Resim bulunamadı")
    if not img.path:
        raise HTTPException(410, "Bu dosyanın saklama süresi doldu")
    try:
        content = blobstore.read(img.path)
    except FileNotFoundError:
        raise HTTPException(404, "Resim bulunamadı")
    headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"}
    if img.content_type in service.VIDEO_TYPES:
        headers["Accept-Ranges"] = "bytes"  # sohbetteki video oynatılır; iOS Safari yalnızca bayt aralığı destekleyen sunucudan oynatır
        if request.headers.get("range"):
            return ranged(content, img.content_type, request.headers["range"], headers)
    # Belgeler (PDF, HTML, Excel) tarayıcıda açılmaz, indirilir (yüklenen bir HTML'in API alanında çalışmasını önler); resim ve video istenirse indirilir.
    if download or (img.content_type not in service.IMAGE_TYPES and img.content_type not in service.VIDEO_TYPES):
        headers.update(attachment(img.filename or f"ulagg-{image_id[:8]}"))
    return Response(content, media_type=img.content_type, headers=headers)


# ------------------------------------------------------------------ mağaza notları (Ayarlar > Yapay Zekâ)


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=memory.MAX_CHARS)


def _note_out(n) -> dict:
    return {"id": n.id, "text": n.text, "source": n.source, "created_at": n.created_at.isoformat()}


@router.get("/memory")
def list_notes(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return {"notes": [_note_out(n) for n in memory.list_notes(db, shop.id)], "max": memory.MAX_NOTES}


@router.post("/memory")
def add_note(body: NoteIn, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return _note_out(memory.add_note(db, shop.id, user.id, body.text, "user"))
    except memory.NoteError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/memory/{note_id}")
def delete_note(note_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    if not memory.delete_note(db, shop.id, note_id):
        raise HTTPException(404, "Not bulunamadı")
    return {"ok": True}


@router.delete("/memory")
def clear_notes(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return {"deleted": memory.clear_notes(db, shop.id)}


@router.get("/dashboard")
def dashboard(today: dt.date | None = None, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return service.dashboard(db, shop, today or dt.date.today())

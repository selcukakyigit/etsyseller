"""Modül kayıtlarının (ModuleEntity) oluşturma / güncelleme / arşivleme / silme işlemleri."""
import datetime as dt
import secrets
from io import BytesIO

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core import blobstore
from app.modkit import activity, currencies, documents
from app.modkit.access import EntityAccess, writable_workspace
from app.modkit.models import ModuleEntity

MAX_ENTITIES_PER_MODULE = 200
IMAGE_MAX_BYTES = 8 * 1024 * 1024
IMAGE_SIZE = 256  # kare, piksel


def image_version(e: ModuleEntity) -> str | None:
    """Resim adresinin sürüm eki: resim değişince tarayıcı eskisini önbellekten göstermesin."""
    if not e.image_path:
        return None
    return e.image_path.rsplit("/", 1)[-1].split(".", 1)[0][-12:]


def _clean_vat(v: float | None) -> float:
    try:
        v = float(v or 0)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "Geçersiz KDV oranı") from exc
    if not 0 <= v <= 100:
        raise HTTPException(422, "Geçersiz KDV oranı")
    return round(v, 2)


def serialize(e: ModuleEntity, access: EntityAccess | None = None) -> dict:
    out = {
        "id": e.id, "module": e.module, "name": e.name, "label": e.label, "currency": e.currency,
        "vat_rate": e.vat_rate, "vat_in_cost": e.vat_in_cost, "archived": e.archived_at is not None,
        "image": image_version(e), "created_at": e.created_at.isoformat() + "Z",
    }
    if access is None or access.internal:  # iletişim ve not iç bilgidir
        out.update({"contact_email": e.contact_email, "note": e.note})
    if access is not None:
        out["access"] = access.summary()
    return out


def create(db: Session, user: User, module: str, name: str, label: str, currency: str | None, vat_rate: float | None,
           vat_in_cost: bool, contact_email: str, note: str) -> ModuleEntity:
    wid = writable_workspace(db, user)
    name = (name or "").strip()[:120]
    if not name:
        raise HTTPException(422, "Ad boş olamaz")
    n = db.scalar(select(func.count()).select_from(ModuleEntity).where(ModuleEntity.workspace_id == wid, ModuleEntity.module == module)) or 0
    if n >= MAX_ENTITIES_PER_MODULE:
        raise HTTPException(422, "Kayıt sınırına ulaşıldı")
    e = ModuleEntity(
        workspace_id=wid, module=module, name=name, label=(label or "").strip()[:60], currency=currencies.clean(currency),
        vat_rate=_clean_vat(vat_rate), vat_in_cost=bool(vat_in_cost), contact_email=(contact_email or "").strip()[:255],
        note=(note or "").strip()[:5000], created_by=user.id,
    )
    db.add(e)
    db.flush()
    activity.log(db, e.id, user, "created", {"name": name})
    db.commit()
    return e


def update(db: Session, access: EntityAccess, fields: dict) -> ModuleEntity:
    access.require_member()
    e = access.entity
    if "name" in fields and fields["name"] is not None:
        name = fields["name"].strip()[:120]
        if not name:
            raise HTTPException(422, "Ad boş olamaz")
        e.name = name
    if fields.get("label") is not None:
        e.label = fields["label"].strip()[:60]
    if fields.get("currency") is not None:
        e.currency = currencies.clean(fields["currency"])
    if fields.get("vat_rate") is not None:
        e.vat_rate = _clean_vat(fields["vat_rate"])
    if fields.get("vat_in_cost") is not None:
        e.vat_in_cost = bool(fields["vat_in_cost"])
    if fields.get("contact_email") is not None:
        e.contact_email = fields["contact_email"].strip()[:255]
    if fields.get("note") is not None:
        e.note = fields["note"].strip()[:5000]
    activity.log(db, e.id, access.user, "updated", {k: v for k, v in fields.items() if v is not None and k != "note"}, internal=True)
    db.commit()
    return e


def set_archived(db: Session, access: EntityAccess, archived: bool) -> None:
    access.require_member()
    access.entity.archived_at = dt.datetime.utcnow() if archived else None
    activity.log(db, access.entity.id, access.user, "archived" if archived else "restored", {}, internal=True)
    db.commit()


def delete(db: Session, access: EntityAccess, confirm_name: str) -> None:
    """Kalıcı silme: kaydın her şeyi (fiyatlar, işler, belgeler, davetler) gider. Ad yazılarak onaylanır."""
    access.require_member()
    if (confirm_name or "").strip() != access.entity.name:
        raise HTTPException(422, "Onay için kaydın adını aynen yaz")
    paths = documents.cleanup_entity_files(db, access.entity.id) + ([access.entity.image_path] if access.entity.image_path else [])
    db.delete(access.entity)
    db.commit()
    blobstore.remove(paths)


def set_image(db: Session, access: EntityAccess, content: bytes) -> ModuleEntity:
    """Logo / profil resmi: ortadan kare kırpılır, 256 px WEBP olarak kalıcı depoya yazılır; eskisi silinir. Dosya
    Pillow ile yeniden kodlandığı için içine gömülü hiçbir şey (EXIF konumu, betik) taşınmaz."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    access.require_member()
    if len(content) > IMAGE_MAX_BYTES:
        raise HTTPException(413, f"Dosya çok büyük (en fazla {IMAGE_MAX_BYTES // (1024 * 1024)} MB)")
    try:
        img = Image.open(BytesIO(content))
        if img.format not in ("PNG", "JPEG", "WEBP", "GIF") or img.width * img.height > 40_000_000:
            raise HTTPException(415, "Desteklenmeyen ya da bozuk dosya")
        img = ImageOps.exif_transpose(img).convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(415, "Desteklenmeyen ya da bozuk dosya") from exc
    side = min(img.width, img.height)
    left, top = (img.width - side) // 2, (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize((IMAGE_SIZE, IMAGE_SIZE), Image.LANCZOS)
    out = BytesIO()
    img.save(out, format="WEBP", quality=88)
    e = access.entity
    old = e.image_path
    e.image_path = blobstore.put(f"modules/{e.workspace_id}/{e.id}/logo-{secrets.token_hex(6)}.webp", out.getvalue(), "image/webp")
    activity.log(db, e.id, access.user, "image_changed", {}, internal=True)
    db.commit()
    if old:
        blobstore.remove([old])
    return e


def remove_image(db: Session, access: EntityAccess) -> ModuleEntity:
    access.require_member()
    e = access.entity
    old = e.image_path
    if old:
        e.image_path = ""
        activity.log(db, e.id, access.user, "image_removed", {}, internal=True)
        db.commit()
        blobstore.remove([old])
    return e

"""Modül kayıtlarına bağlı belge dosyaları. Dosya kalıcı depoda (core/blobstore), satır `entity_documents` tablosunda.

Yüklenen içerik uzantısına ve ilk baytlarına göre doğrulanır (istemcinin gönderdiği Content-Type'a güvenilmez);
depoya yazılan tür, doğrulanmış uzantıdan gelir."""
import json
import re
import uuid

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core import blobstore
from app.modkit import activity
from app.modkit.access import EntityAccess
from app.modkit.analyzer import sha256
from app.modkit.models import EntityDocument, ModuleEntity, ProductMeasure

MAX_BYTES = 15 * 1024 * 1024
MAX_DOCS_PER_ENTITY = 2000

TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".txt": "text/plain",
}
ACCEPT = ",".join(TYPES)


def _ext(filename: str) -> str:
    name = (filename or "").lower()
    return name[name.rfind("."):] if "." in name else ""


def _looks_like(ext: str, data: bytes) -> bool:
    if ext == ".pdf":
        return data.lstrip()[:5] == b"%PDF-"
    if ext == ".png":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if ext in (".jpg", ".jpeg"):
        return data[:3] == b"\xff\xd8\xff"
    if ext == ".webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if ext == ".xlsx":
        return data[:4] == b"PK\x03\x04"
    if ext == ".xls":
        return data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    return b"\x00" not in data[:4096]  # metin türleri


def validate(content: bytes, filename: str) -> str:
    """Doğrulanmış içerik türünü döner; desteklenmeyen ya da içeriği uzantısıyla uyuşmayan dosyada 415."""
    ext = _ext(filename)
    if ext not in TYPES or not content or not _looks_like(ext, content):
        raise HTTPException(415, "Desteklenmeyen ya da bozuk dosya")
    if len(content) > MAX_BYTES:
        raise HTTPException(413, f"Dosya çok büyük (en fazla {MAX_BYTES // (1024 * 1024)} MB)")
    return TYPES[ext]


def safe_name(filename: str) -> str:
    base = re.sub(r"[^\w.\- ()]+", "_", (filename or "").replace("\\", "/").rsplit("/", 1)[-1]).strip(" .")
    return (base or "belge")[:200]


def _check_quota(db: Session, entity_id: int) -> None:
    n = db.scalar(select(func.count()).select_from(EntityDocument).where(EntityDocument.entity_id == entity_id)) or 0
    if n >= MAX_DOCS_PER_ENTITY:
        raise HTTPException(422, "Belge sınırına ulaşıldı; eski belgeleri silin.")


def existing(db: Session, access: EntityAccess, content: bytes) -> EntityDocument | None:
    """Bu kayıtta aynı içerikte (SHA-256) daha önce yüklenmiş belge varsa en eskisi: aynı dosya ikinci kez kaydedilmez."""
    return db.scalars(select(EntityDocument).where(
        EntityDocument.entity_id == access.entity.id, EntityDocument.sha256 == sha256(content)
    ).order_by(EntityDocument.id).limit(1)).first()


def save(db: Session, access: EntityAccess, content: bytes, filename: str, content_type: str, profile: str) -> EntityDocument:
    """Dosyayı depoya yazar, satırı ekler (commit etmez — çağıran, okuma sonucunu da yazıp tek seferde kaydeder)."""
    _check_quota(db, access.entity.id)
    name = safe_name(filename)
    ext = _ext(name) or ".bin"
    key = f"modules/{access.entity.workspace_id}/{access.entity.id}/{uuid.uuid4().hex}{ext}"
    path = blobstore.put(key, content, content_type)
    doc = EntityDocument(
        entity_id=access.entity.id, uploaded_by=access.user.id, filename=name, content_type=content_type, size=len(content),
        sha256=sha256(content), path=path, profile=profile,
    )
    db.add(doc)
    db.flush()
    return doc


def discard_file(db: Session, doc: EntityDocument) -> None:
    """Belge başarıyla okunduktan sonra dosyayı depodan siler; kayıtta yalnızca ad, boyut ve okunan veri kalır (dosya saklanmaz).
    Okuma başarısız olduysa çağrılmaz: dosya yeniden denemek için durur."""
    path = doc.path
    if not path:
        return
    doc.path = ""
    db.commit()
    blobstore.remove([path])


def set_result(doc: EntityDocument, data: dict | None, source: str) -> None:
    doc.extracted_json = json.dumps(data, ensure_ascii=False, default=str) if data is not None else None
    doc.extract_source = source


def get(db: Session, access: EntityAccess, doc_id: int) -> EntityDocument:
    doc = db.get(EntityDocument, doc_id)
    if doc is None or doc.entity_id != access.entity.id:
        raise HTTPException(404, "Belge bulunamadı")
    return doc


def serialize(doc: EntityDocument, uploader: str = "") -> dict:
    return {
        "id": doc.id, "filename": doc.filename, "content_type": doc.content_type, "size": doc.size, "profile": doc.profile,
        "source": doc.extract_source, "has_data": doc.extracted_json is not None, "has_file": bool(doc.path),
        "uploaded_by": uploader, "created_at": doc.created_at.isoformat() + "Z",
    }


def data_of(doc: EntityDocument) -> dict | None:
    try:
        return json.loads(doc.extracted_json) if doc.extracted_json else None
    except json.JSONDecodeError:
        return None


def remove(db: Session, access: EntityAccess, doc: EntityDocument) -> None:
    """Çalışma alanı üyesi her belgeyi, misafir yalnızca kendi yüklediğini siler."""
    if not (access.is_member or (access.is_guest and doc.uploaded_by == access.user.id)):
        raise HTTPException(403, "Bu işlem için yetkin yok")
    path = doc.path
    activity.log(db, access.entity.id, access.user, "document_deleted", {"filename": doc.filename})
    db.delete(doc)
    db.commit()
    if path:
        blobstore.remove([path])


def wipe_workspaces(db: Session, workspace_ids: list[int]) -> None:
    """Çalışma alanlarının tüm modül kayıtlarını, ürün tanımlarını ve depodaki belgelerini siler. Hesap sıfırlama / silme kullanır.
    Satırlar yabancı anahtarlarla zincirleme silinir; dosyalar satırlar silindikten sonra depodan kaldırılır."""
    if not workspace_ids:
        return
    ids = select(ModuleEntity.id).where(ModuleEntity.workspace_id.in_(workspace_ids))
    paths = [p for p in db.scalars(select(EntityDocument.path).where(EntityDocument.entity_id.in_(ids))) if p]
    paths += [p for p in db.scalars(select(ModuleEntity.image_path).where(ModuleEntity.workspace_id.in_(workspace_ids))) if p]
    db.execute(delete(ModuleEntity).where(ModuleEntity.workspace_id.in_(workspace_ids)))
    db.execute(delete(ProductMeasure).where(ProductMeasure.workspace_id.in_(workspace_ids)))
    db.commit()
    blobstore.remove(paths)


def cleanup_entity_files(db: Session, entity_id: int) -> list[str]:
    """Kayıt silinmeden önce depodaki dosya yolları (silindikten sonra depodan kaldırılmak üzere)."""
    return [p for p in db.scalars(select(EntityDocument.path).where(EntityDocument.entity_id == entity_id)) if p]

"""Dijital (indirilebilir) listing: dosya sınırları, doğrulama ve Etsy'ye dosya yükleme.

Etsy kuralları: dijital listing'de en fazla 5 dosya, her biri en fazla 20 MB; kargo/işlem profili ve varyasyon yoktur; aktif etmek için en az bir dosya gerekir.
Çalışma kopyasında: `listing_type == "download"` ve `digital_files: [{draft_file_id, filename, size, file_id?}]`; `file_id` Etsy'ye yüklenmiş dosyayı gösterir."""
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from app.core import blobstore
from app.etsy import files as etsy_files
from app.etsy.client import EtsyClient
from app.listings import drafts
from app.shops.models import Shop

log = logging.getLogger(__name__)

MAX_FILES = 5
MAX_FILE_BYTES = 20 * 1024 * 1024
# Etsy'nin kabul ettiği dijital dosya türleri (uzantı): belge, görsel, arşiv, ses/video ve tasarım dosyaları.
ALLOWED_EXTENSIONS = {
    ".pdf", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".eps", ".ai", ".psd", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".txt", ".epub",
    ".mp3", ".mp4", ".mov", ".ttf", ".otf", ".dxf", ".stl", ".cut", ".studio3", ".mp3", ".wav", ".json", ".csv", ".odt", ".ods",
}


def is_digital(work: dict) -> bool:
    return work.get("listing_type") == "download"


def extension_ok(filename: str) -> bool:
    return Path(filename or "").suffix.lower() in ALLOWED_EXTENSIONS


def problems(work: dict, activate: bool) -> list[str]:
    """Dijital listing'e özel eksikler (fiziksel listing'in kargo/varyasyon kuralları uygulanmaz)."""
    if not is_digital(work):
        return []
    out = []
    files = work.get("digital_files") or []
    if len(files) > MAX_FILES:
        out.append(f"Dijital listing'de en fazla {MAX_FILES} dosya olabilir.")
    if activate and not files:
        out.append("Aktif etmek için en az bir dijital dosya gerekli.")
    products = (work.get("inventory") or {}).get("products", [])
    if any(p.get("property_values") for p in products):
        out.append("Dijital listing'de varyasyon kullanılamaz (Etsy kuralı); varyasyonları kaldır.")
    return out


def pending(work: dict) -> list[dict]:
    """Etsy'ye henüz yüklenmemiş (taslak dosyası olan, Etsy kimliği olmayan) dijital dosyalar."""
    return [f for f in work.get("digital_files") or [] if f.get("draft_file_id") and not f.get("file_id")]


def upload_pending(db: Session, shop: Shop, client: EtsyClient, listing_id: int, work: dict) -> int:
    """Bekleyen dosyaları Etsy'ye yükler ve çalışma kopyasına Etsy dosya kimliğini yazar. Döner: yüklenen dosya sayısı."""
    uploaded = 0
    for rank, entry in enumerate(work.get("digital_files") or [], start=1):
        if entry.get("file_id") or not entry.get("draft_file_id"):
            continue
        f = drafts.get_file(db, shop, listing_id, entry["draft_file_id"])
        if f is None:
            raise ValueError(f'Taslak dosyası bulunamadı: {entry.get("filename")}; dosyayı yeniden ekle.')
        result = etsy_files.upload_listing_file(client, listing_id, blobstore.read(f.path), entry.get("filename") or f.filename, rank)
        entry["file_id"] = result.get("listing_file_id")
        uploaded += 1
    log.info("Listing %s: %s dijital dosya yüklendi", listing_id, uploaded)
    return uploaded

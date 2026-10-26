"""Kullanıcıdan gelen ek dosyaların ortak doğrulaması (iletişim formu, destek talepleri): izin verilen türler, boyut ve
dosya adındaki uzantıya değil içeriğin gerçek imzasına bakan kontrol."""
import re

from fastapi import HTTPException, UploadFile

MAX_FILE_BYTES = 10 * 1024 * 1024
# uzantı -> (içerik türü, imza kontrolü)
ALLOWED: dict[str, tuple[str, str]] = {
    "jpg": ("image/jpeg", "jpeg"),
    "jpeg": ("image/jpeg", "jpeg"),
    "png": ("image/png", "png"),
    "gif": ("image/gif", "gif"),
    "webp": ("image/webp", "webp"),
    "pdf": ("application/pdf", "pdf"),
    "txt": ("text/plain", "text"),
    "csv": ("text/csv", "text"),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "zip"),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "zip"),
}


def signature_ok(kind: str, data: bytes) -> bool:
    if kind == "jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if kind == "png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if kind == "gif":
        return data[:4] == b"GIF8"
    if kind == "webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if kind == "pdf":
        return data.lstrip()[:5] == b"%PDF-"
    if kind == "zip":
        return data[:4] == b"PK\x03\x04"
    if kind == "text":
        return b"\x00" not in data[:4096]
    return False


def safe_name(name: str) -> str:
    base = re.sub(r"[^\w.\- ]+", "_", name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]).strip(" .")
    return (base or "file")[:120]


def validate_file(name: str, data: bytes) -> tuple[str, str, bytes]:
    """(güvenli ad, içerik türü, bayt): tür, boyut ve içeriğin gerçek imzası denetlenir; geçersizse 4xx fırlatır."""
    fname = safe_name(name or "file")
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    if ext not in ALLOWED:
        raise HTTPException(422, f"File type not allowed: {fname}")
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, f"{fname} is larger than 10 MB.")
    ctype, kind = ALLOWED[ext]
    if not data or not signature_ok(kind, data):
        raise HTTPException(422, f"File content does not match its type: {fname}")
    return fname, ctype, data


async def read_uploads(files: list[UploadFile], max_files: int) -> list[tuple[str, str, bytes]]:
    """Seçilen dosyaları doğrulayıp (güvenli ad, içerik türü, bayt) listesi döner; geçersizse 4xx fırlatır."""
    files = [f for f in files if f.filename]
    if len(files) > max_files:
        raise HTTPException(422, f"At most {max_files} files.")
    return [validate_file(f.filename or "file", await f.read(MAX_FILE_BYTES + 1)) for f in files]

"""Kullanıcı dosyaları (taslak fotoğraf/videoları, asistana gönderilen resimler) için kalıcı depo.

Render'ın diski geçicidir: her yayında (deploy) ve yeniden başlatmada silinir, diske yazılan dosyalar kaybolur ve
ekranda kırık resim olarak görünür. Bu yüzden Supabase ayarlıysa dosyalar özel bir Supabase Storage kovasına yazılır;
veritabanındaki `path` alanında "sb:<anahtar>" olarak tutulur. Supabase ayarlı değilse (yerel geliştirme, testler)
eskisi gibi `uploads/` altına yazılır. Eski satırlardaki düz disk yolları da okunmaya devam eder."""
import logging
from pathlib import Path

import httpx

from app.core import storage
from app.core.config import settings

log = logging.getLogger("app.blobstore")

BUCKET = "app-files"
MAX_BYTES = 50 * 1024 * 1024  # Supabase'in ücretsiz plandaki dosya başı sınırı
PREFIX = "sb:"
LOCAL_ROOT = Path(__file__).resolve().parents[2] / "uploads"


def _remote() -> bool:
    return bool(settings.supabase_url and settings.supabase_secret_key)


def put(key: str, content: bytes, content_type: str) -> str:
    """Dosyayı kaydeder, veritabanına yazılacak yolu döner. `key` örn. "drafts/12/-3/<uuid>.jpg"."""
    if _remote():
        storage.ensure_bucket(BUCKET, MAX_BYTES)
        storage.upload(BUCKET, key, content, content_type or "application/octet-stream")
        return PREFIX + key
    path = LOCAL_ROOT / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return str(path)


def read(path: str) -> bytes:
    """Dosyanın içeriği; yoksa FileNotFoundError."""
    if path.startswith(PREFIX):
        resp = httpx.get(f"{storage._base()}/object/{BUCKET}/{path[len(PREFIX):]}", headers=storage._headers(), timeout=60)
        if resp.status_code in (400, 404):
            raise FileNotFoundError(path)
        resp.raise_for_status()
        return resp.content
    return Path(path).read_bytes()


def remove(paths: list[str]) -> None:
    """Dosyaları siler; olmayanları ve depo hatalarını sessizce geçer (silme, asıl işlemi bozmamalı)."""
    keys = [p[len(PREFIX):] for p in paths if p and p.startswith(PREFIX)]
    for p in paths:
        if p and not p.startswith(PREFIX):
            Path(p).unlink(missing_ok=True)
    for i in range(0, len(keys), 500):
        try:
            resp = httpx.request("DELETE", f"{storage._base()}/object/{BUCKET}", headers=storage._headers(), json={"prefixes": keys[i:i + 500]}, timeout=60)
            resp.raise_for_status()
        except Exception:  # noqa: BLE001
            log.warning("Depodaki %s dosya silinemedi", len(keys[i:i + 500]), exc_info=True)

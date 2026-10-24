import secrets
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core import blobstore

# Avatarlar kalıcı depoda ("avatars/<ad>"): Render'ın diski her yayında silindiği için yerel diske yazılan fotoğraf kırık resme dönerdi.
AVATAR_PREFIX = "avatars/"

ALLOWED_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
AVATAR_SIZE = 512  # square, in pixels


class InvalidAvatar(Exception):
    pass


def update_profile(db: Session, user: User, name: str | None) -> User:
    if name is not None:
        user.name = name.strip() or None
        db.commit()
    return user


def save_avatar(db: Session, user: User, filename: str, content: bytes) -> User:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_AVATAR_EXTENSIONS:
        raise InvalidAvatar(f"Desteklenmeyen dosya türü: {ext or 'bilinmiyor'}")

    try:
        image = Image.open(BytesIO(content)).convert("RGB")
    except UnidentifiedImageError as exc:
        raise InvalidAvatar("Geçersiz görsel dosyası") from exc

    # Center-crop to a square, then resize — so any uploaded photo becomes a
    # consistent, evenly-cropped avatar regardless of its original aspect ratio.
    side = min(image.width, image.height)
    left, top = (image.width - side) // 2, (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize(
        (AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS
    )

    # Rastgele ek, URL'nin tahmin edilmesini ve eski fotoğrafın önbellekte kalmasını engeller.
    new_filename = f"{user.id}-{secrets.token_urlsafe(12)}.png"
    out = BytesIO()
    image.save(out, format="PNG")
    blobstore.put(AVATAR_PREFIX + new_filename, out.getvalue(), "image/png")
    old = user.avatar_filename
    user.avatar_filename = new_filename
    db.commit()
    if old:
        remove_avatar_file(old)
    return user


def read_avatar(name: str) -> bytes:
    """Avatar dosyasının içeriği; yoksa FileNotFoundError."""
    return blobstore.read(blobstore.path_of(AVATAR_PREFIX + name))


def remove_avatar_file(name: str) -> None:
    blobstore.remove([blobstore.path_of(AVATAR_PREFIX + name)])

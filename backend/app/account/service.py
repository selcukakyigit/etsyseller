from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import settings
from app.core.env_store import mask_secret, set_env_values
from app.core.security import hash_password, verify_password

AVATAR_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
AVATAR_SIZE = 512  # square, in pixels


class InvalidAvatar(Exception):
    pass


class WrongPassword(Exception):
    pass


class WeakPassword(Exception):
    pass


def change_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise WrongPassword("Mevcut şifre yanlış")
    if len(new_password) < 8:
        raise WeakPassword("Yeni şifre en az 8 karakter olmalı")
    user.password_hash = hash_password(new_password)
    db.commit()


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

    new_filename = f"{user.id}.png"
    image.save(AVATAR_DIR / new_filename, format="PNG")
    user.avatar_filename = new_filename
    db.commit()
    return user


def get_api_keys() -> dict:
    return {
        "etsy_api_key": mask_secret(settings.etsy_api_key),
        "etsy_shared_secret": mask_secret(settings.etsy_shared_secret),
        "openai_api_key": mask_secret(settings.openai_api_key),
        "openai_model": settings.openai_model,
        "anthropic_api_key": mask_secret(settings.anthropic_api_key),
        "anthropic_model": settings.anthropic_model,
        "ai_provider": settings.ai_provider,
    }


def update_api_keys(values: dict[str, str]) -> dict:
    non_blank = {key: value for key, value in values.items() if value}
    if non_blank:
        set_env_values(non_blank)
    return get_api_keys()


def test_etsy_connection() -> dict:
    from app.taxonomy import service as taxonomy_service

    try:
        taxonomy_service.get_seller_taxonomy_nodes()
        return {"ok": True, "message": "Etsy bağlantısı başarılı"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


def test_openai_connection() -> dict:
    from app.ai.client import get_openai_client

    try:
        get_openai_client().models.list()
        return {"ok": True, "message": "OpenAI bağlantısı başarılı"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


def test_anthropic_connection() -> dict:
    from app.ai.client import get_anthropic_client

    try:
        get_anthropic_client().models.list(limit=1)
        return {"ok": True, "message": "Claude bağlantısı başarılı"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}

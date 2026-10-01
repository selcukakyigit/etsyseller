import httpx
import jwt
from fastapi import Cookie, Depends, Header, HTTPException, Request
from jwt import PyJWKClient
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.workspaces import create_personal_workspace
from app.core.config import settings
from app.core.db import get_db

_jwks_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(settings.supabase_jwks_url, cache_keys=True, lifespan=3600)
    return _jwks_client


def _verify_token(token: str) -> dict:
    """Supabase'in imzaladığı erişim belirtecini JWKS ile doğrular (imza, süre, issuer, audience)."""
    if not settings.supabase_jwks_url:
        raise HTTPException(500, "Kimlik doğrulama yapılandırılmamış (SUPABASE_JWKS_URL)")
    try:
        key = _jwks().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=f"{settings.supabase_url.rstrip('/')}/auth/v1",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "Oturum geçersiz veya süresi dolmuş") from exc


def _picture(meta: dict) -> str | None:
    url = meta.get("avatar_url") or meta.get("picture")
    return url[:500] if isinstance(url, str) and url.startswith("https://") else None


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    cookie_token: str | None = Cookie(default=None, alias="ulagg_at"),
) -> User:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif cookie_token and request.method in ("GET", "HEAD"):
        # <img src>, dosya indirme ve Etsy'ye bağlanma yönlendirmesi gibi başlık gönderemeyen GET istekleri için.
        # Değiştiren (POST/PUT/DELETE) isteklerde çerez kabul edilmez: CSRF'e karşı Authorization başlığı şart.
        token = cookie_token
    else:
        raise HTTPException(401, "Giriş yapılmamış")
    claims = _verify_token(token)

    supabase_id = claims["sub"]
    user = db.query(User).filter_by(supabase_id=supabase_id).one_or_none()
    if user is None:
        # Silinmiş hesabın henüz süresi dolmamış belirteci yerel kaydı yeniden yaratmasın: ilk kayıtta kullanıcının
        # Supabase'de hâlâ var olduğunu doğrula.
        try:
            alive = httpx.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}"},
                timeout=10,
            ).status_code == 200
        except httpx.HTTPError as exc:
            raise HTTPException(503, "Kimlik servisine ulaşılamadı") from exc
        if not alive:
            raise HTTPException(401, "Oturum geçersiz veya süresi dolmuş")
        email = (claims.get("email") or "").lower()
        if not email:
            raise HTTPException(401, "Hesapta e-posta yok")
        meta = claims.get("user_metadata") or {}
        user = User(
            supabase_id=supabase_id,
            email=email,
            name=meta.get("full_name") or meta.get("name"),
            picture_url=_picture(meta),
        )
        db.add(user)
        db.flush()
        create_personal_workspace(db, user)
        db.refresh(user)
    else:
        # Google fotoğrafı sonradan eklenmiş/değişmiş olabilir (ör. hesap bu özellikten önce açıldıysa).
        picture = _picture(claims.get("user_metadata") or {})
        if picture and user.picture_url != picture:
            user.picture_url = picture
            db.commit()
    return user


def is_admin(user: User) -> bool:
    admins = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    return user.email.lower() in admins


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin(user):
        raise HTTPException(403, "Bu işlem için yönetici yetkisi gerekir")
    return user

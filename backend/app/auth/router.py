from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User, UserConsent
from app.auth.schemas import ConsentIn, UserOut
from app.core.config import settings
from app.core.db import get_db
from app.auth import access
from app.core.deps import get_current_user
from app.core.net import client_ip

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _latest_consent(db: Session, user: User) -> str | None:
    return db.scalar(select(UserConsent.version).where(UserConsent.user_id == user.id).order_by(UserConsent.id.desc()).limit(1))


def user_out(db: Session, user: User) -> UserOut:
    version = _latest_consent(db, user)
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar_url=user.avatar_url,
        is_admin=access.is_admin(db, user),
        status=access.status_of(db, user),
        consent_version=version,
        needs_consent=version != settings.legal_version,
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_out(db, user)


@router.post("/consent", response_model=UserOut)
def accept_terms(
    payload: ConsentIn, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Kullanım Koşulları / Gizlilik / KVKK metninin güncel sürümünün kabulünü sürüm, zaman ve IP ile kaydeder."""
    if payload.version != settings.legal_version:
        raise HTTPException(409, "Metinler güncellendi, sayfayı yenileyip tekrar deneyin")
    ip = client_ip(request)
    db.add(UserConsent(user_id=user.id, version=payload.version, ip=ip, user_agent=(request.headers.get("user-agent") or "")[:255]))
    db.commit()
    return user_out(db, user)

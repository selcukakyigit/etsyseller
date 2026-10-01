from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.account import danger, service
from app.account.schemas import ApiKeysOut, ApiKeysUpdateIn, ApiKeyTestOut, DangerIn, ProfileUpdateIn
from pydantic import BaseModel

from app.auth.models import User
from app.auth.workspaces import primary_workspace
from app.auth.router import user_out
from app.auth.schemas import UserOut
from app.core.db import get_db
from app.core.deps import get_current_user, require_admin
from app.core.uploads import read_limited

router = APIRouter(prefix="/api/account", tags=["account"])

MAX_AVATAR_BYTES = 5 * 1024 * 1024


@router.put("/profile", response_model=UserOut)
def update_profile(
    payload: ProfileUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return user_out(db, service.update_profile(db, user, payload.name))


@router.post("/avatar", response_model=UserOut)
async def upload_avatar(
    avatar: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await read_limited(avatar, MAX_AVATAR_BYTES, "Görsel")
    try:
        return user_out(db, service.save_avatar(db, user, avatar.filename or "avatar.png", content))
    except service.InvalidAvatar as exc:
        raise HTTPException(400, str(exc)) from exc


class AiSettingIn(BaseModel):
    enabled: bool


@router.get("/ai")
def get_ai_setting(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"enabled": primary_workspace(db, user).ai_enabled}


@router.put("/ai")
def set_ai_setting(payload: AiSettingIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Yapay zekâ özelliklerini bu çalışma alanı için açar/kapatır. Kapalıyken içerik AI sağlayıcılarına gönderilmez."""
    ws = primary_workspace(db, user)
    ws.ai_enabled = payload.enabled
    db.commit()
    return {"enabled": ws.ai_enabled}


@router.get("/api-keys", response_model=ApiKeysOut)
def api_keys(user: User = Depends(require_admin)):
    return service.get_api_keys()


@router.put("/api-keys", response_model=ApiKeysOut)
def update_api_keys(payload: ApiKeysUpdateIn, user: User = Depends(require_admin)):
    return service.update_api_keys(payload.model_dump(exclude_none=True))


TEST_FUNCS = {
    "etsy": service.test_etsy_connection,
    "openai": service.test_openai_connection,
    "anthropic": service.test_anthropic_connection,
    "google": service.test_google_connection,
}


@router.post("/api-keys/test/{provider}", response_model=ApiKeyTestOut)
def test_api_key(provider: str, user: User = Depends(require_admin)):
    test_func = TEST_FUNCS.get(provider)
    if test_func is None:
        raise HTTPException(404, f"Bilinmeyen sağlayıcı: {provider}")
    return test_func()


def _checked(payload: DangerIn, user: User) -> None:
    if not payload.confirm:
        raise HTTPException(400, "İşlemi onaylamanız gerekiyor")
    try:
        danger.verify(user, payload.email)
    except danger.WrongConfirmation as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/reset-data")
def reset_data(payload: DangerIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Tüm verileri sıfırlar (mağaza bağlantıları ve yerel veriler); hesap ve şifre kalır."""
    _checked(payload, user)
    danger.reset_data(db, user)
    return {"ok": True}


@router.post("/delete")
def delete_account(payload: DangerIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Hesabı ve tüm verilerini kalıcı olarak siler (Supabase kimlik kaydı dahil)."""
    _checked(payload, user)
    danger.delete_account(db, user)
    return {"ok": True}

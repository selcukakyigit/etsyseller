from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.account import service
from app.account.schemas import ApiKeysOut, ApiKeysUpdateIn, ApiKeyTestOut, PasswordChangeIn, ProfileUpdateIn
from app.auth.models import User
from app.auth.schemas import UserOut
from app.core.db import get_db
from app.core.deps import get_current_user

router = APIRouter(prefix="/api/account", tags=["account"])

MAX_AVATAR_BYTES = 5 * 1024 * 1024


@router.put("/profile", response_model=UserOut)
def update_profile(
    payload: ProfileUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.update_profile(db, user, payload.name)


@router.post("/avatar", response_model=UserOut)
async def upload_avatar(
    avatar: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await avatar.read()
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "Görsel çok büyük (maksimum 5MB)")
    try:
        return service.save_avatar(db, user, avatar.filename or "avatar.png", content)
    except service.InvalidAvatar as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api-keys", response_model=ApiKeysOut)
def api_keys(user: User = Depends(get_current_user)):
    return service.get_api_keys()


@router.put("/api-keys", response_model=ApiKeysOut)
def update_api_keys(payload: ApiKeysUpdateIn, user: User = Depends(get_current_user)):
    return service.update_api_keys(payload.model_dump(exclude_none=True))


TEST_FUNCS = {
    "etsy": service.test_etsy_connection,
    "openai": service.test_openai_connection,
    "anthropic": service.test_anthropic_connection,
}


@router.post("/api-keys/test/{provider}", response_model=ApiKeyTestOut)
def test_api_key(provider: str, user: User = Depends(get_current_user)):
    test_func = TEST_FUNCS.get(provider)
    if test_func is None:
        raise HTTPException(404, f"Bilinmeyen sağlayıcı: {provider}")
    return test_func()


@router.put("/password")
def change_password(
    payload: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    try:
        service.change_password(db, user, payload.current_password, payload.new_password)
    except service.WrongPassword as exc:
        raise HTTPException(400, str(exc)) from exc
    except service.WeakPassword as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}

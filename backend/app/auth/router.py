import datetime as dt

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.models import User
from app.auth.schemas import LoginRequest, RegisterRequest, UserOut
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
        max_age=settings.session_max_age_days * 24 * 60 * 60,
        path="/",
    )


@router.post("/register", response_model=UserOut)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    try:
        user = service.register(db, payload.email, payload.password)
    except service.AuthError as exc:
        raise HTTPException(400, str(exc)) from exc

    token, _ = service.create_session(db, user)
    _set_session_cookie(response, token)
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    try:
        user = service.authenticate(db, payload.email, payload.password)
    except service.AuthError as exc:
        raise HTTPException(401, str(exc)) from exc

    token, _ = service.create_session(db, user)
    _set_session_cookie(response, token)
    return user


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
):
    if session_token:
        service.destroy_session(db, session_token)
    response.delete_cookie(settings.session_cookie_name, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user

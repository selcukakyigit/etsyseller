import datetime as dt

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.models import Session as SessionModel
from app.auth.models import User
from app.core.config import settings
from app.core.db import get_db


def get_current_user(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> User:
    if session_token is None:
        raise HTTPException(401, "Giriş yapılmamış")

    session = db.get(SessionModel, session_token)
    if session is None or session.expires_at <= dt.datetime.utcnow():
        raise HTTPException(401, "Oturum geçersiz veya süresi dolmuş")

    return session.user

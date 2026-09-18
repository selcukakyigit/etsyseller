import datetime as dt

from sqlalchemy.orm import Session

from app.auth.models import Session as SessionModel
from app.auth.models import User
from app.core.config import settings
from app.core.security import generate_token, hash_password, verify_password


class AuthError(Exception):
    pass


def register(db: Session, email: str, password: str) -> User:
    existing = db.query(User).filter_by(email=email).one_or_none()
    if existing is not None:
        raise AuthError("Bu e-posta zaten kayıtlı.")

    user = User(email=email, password_hash=hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.query(User).filter_by(email=email).one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise AuthError("E-posta veya şifre hatalı.")
    return user


def create_session(db: Session, user: User) -> tuple[str, dt.datetime]:
    token = generate_token()
    expires_at = dt.datetime.utcnow() + dt.timedelta(days=settings.session_max_age_days)
    db.add(SessionModel(token=token, user_id=user.id, expires_at=expires_at))
    db.commit()
    return token, expires_at


def destroy_session(db: Session, token: str) -> None:
    session = db.get(SessionModel, token)
    if session is not None:
        db.delete(session)
        db.commit()

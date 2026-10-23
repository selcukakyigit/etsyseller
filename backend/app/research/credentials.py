"""Sağlayıcı kimlik bilgisi: önce veritabanındaki şifreli kayıt (Yönetim > Araştırma), yoksa .env. Arayüze asla düz metin dönmez."""
import datetime as dt

from sqlalchemy.orm import Session

from app.core.config import settings
from app.research.models import ResearchProviderKey
from app.research.providers.base import Credentials

_ENV = {"dataforseo": lambda: (settings.dataforseo_login, settings.dataforseo_password)}


def get(db: Session, provider: str) -> Credentials | None:
    row = db.get(ResearchProviderKey, provider)
    if row and row.login and row.password:
        return Credentials(row.login, row.password)
    login, password = _ENV[provider]()
    return Credentials(login, password) if login and password else None


def source(db: Session, provider: str) -> str:
    """none | database | env — yalnızca durum göstermek için."""
    row = db.get(ResearchProviderKey, provider)
    if row and row.login and row.password:
        return "database"
    return "env" if get(db, provider) else "none"


def save(db: Session, provider: str, login: str, password: str) -> None:
    row = db.get(ResearchProviderKey, provider)
    if row is None:
        db.add(ResearchProviderKey(provider=provider, login=login, password=password))
    else:
        row.login, row.password, row.updated_at = login, password, dt.datetime.utcnow()
    db.commit()


def clear(db: Session, provider: str) -> None:
    row = db.get(ResearchProviderKey, provider)
    if row:
        db.delete(row)
        db.commit()

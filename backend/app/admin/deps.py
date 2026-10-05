from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.access import is_admin
from app.auth.models import User
from app.core.db import get_db
from app.core.deps import get_current_user


def admin_only(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """Yönetici değilse 404 döner (403 değil): panelin varlığı dışarıdan anlaşılmasın."""
    if not is_admin(db, user):
        raise HTTPException(404, "Sayfa bulunamadı")
    return user


class AdminError(Exception):
    """Yönetim servislerinin kullanıcıya gösterilecek hatası; router HTTP durum koduyla döner."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status

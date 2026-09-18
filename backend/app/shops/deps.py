from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.db import get_db
from app.core.deps import get_current_user
from app.shops.models import Shop


def get_owned_shop(
    shop_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None or shop.user_id != user.id:
        raise HTTPException(404, "Mağaza bulunamadı")
    return shop

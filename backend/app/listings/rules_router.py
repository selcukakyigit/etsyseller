"""Etsy listing yazma kuralları (izin verilen karakterler, sınırlar): düzenleyici formu girişte bunları uygular. Kaynak: `etsy_rules` (tek kaynak)."""
from fastapi import APIRouter, Depends

from app.auth.models import User
from app.core.deps import get_current_user
from app.listings import etsy_rules

router = APIRouter(prefix="/api/etsy-rules", tags=["listings"])


@router.get("")
def rules(user: User = Depends(get_current_user)):
    return etsy_rules.rules_for_client()

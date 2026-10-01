import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.models import User, Workspace
from app.auth.workspaces import workspace_ids
from app.core.db import get_db
from app.core.deps import get_current_user
from app.shops.models import Shop


def get_owned_shop(
    shop_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Shop:
    shop = db.get(Shop, shop_id)
    if shop is None or shop.workspace_id not in workspace_ids(db, user):
        raise HTTPException(404, "Mağaza bulunamadı")
    return shop


def require_ai_enabled(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)) -> None:
    """Yapay zekâ kullanan uç noktalara `dependencies=[Depends(require_ai_enabled)]` olarak eklenir. Çalışma alanı AI'ı
    kapattıysa içerik sağlayıcıya gitmeden 403 döner."""
    ws = db.get(Workspace, shop.workspace_id)
    if ws is not None and not ws.ai_enabled:
        raise HTTPException(403, "Yapay zekâ özellikleri kapalı. Ayarlar > Yapay Zekâ bölümünden açabilirsin.")
    # Çalışma alanı başına 10 dakikada en fazla AI_MAX_CALLS istek: ele geçirilmiş ya da kötü niyetli bir hesabın AI
    # sağlayıcı faturasını şişirmesini önler. Bellek içi sayaç (tek kopya için yeterli; ölçeklenince Redis'e taşınmalı).
    now = time.time()
    hits = _ai_hits[shop.workspace_id]
    while hits and now - hits[0] > AI_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= AI_MAX_CALLS:
        raise HTTPException(429, "Kısa sürede çok fazla yapay zekâ isteği gönderildi. Birkaç dakika sonra tekrar dene.")
    hits.append(now)


AI_WINDOW_SECONDS = 600
AI_MAX_CALLS = 60
_ai_hits: dict[int, deque[float]] = defaultdict(deque)

import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.models import User, Workspace
from app.auth.workspaces import workspace_ids
from app.billing import credits
from app.billing.metering import Scope, set_scope
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.i18n import tr
from app.core.limits import Concurrency
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


def check_ai_allowed(db: Session, workspace_id: int, user: User) -> Scope:
    """AI isteğine izin kontrolleri — mağazaya bağlı olmayan modüller (Dış Tedarik…) de aynı kuralla geçer.
    AI kapalıysa 403, istek sınırı aşıldıysa 429, kredi bittiyse 402."""
    ws = db.get(Workspace, workspace_id)
    if ws is not None and not ws.ai_enabled:
        raise HTTPException(403, "Yapay zekâ özellikleri kapalı. Ayarlar > Yapay Zekâ bölümünden açabilirsin.")
    # Çalışma alanı başına 10 dakikada en fazla AI_MAX_CALLS istek: ele geçirilmiş ya da kötü niyetli bir hesabın AI
    # sağlayıcı faturasını şişirmesini önler. Bellek içi sayaç (tek kopya için yeterli; ölçeklenince Redis'e taşınmalı).
    now = time.time()
    hits = _ai_hits[workspace_id]
    while hits and now - hits[0] > AI_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= AI_MAX_CALLS:
        raise HTTPException(429, "Kısa sürede çok fazla yapay zekâ isteği gönderildi. Birkaç dakika sonra tekrar dene.")
    if not credits.has_credits(workspace_id):
        raise HTTPException(402, "Kredin bitti. Ayarlar > Plan ve krediler bölümünden kredi alabilirsin.")
    hits.append(now)
    return Scope(workspace_id=workspace_id, user_id=user.id)


def _ai_allowed(shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Scope:
    """AI isteğine izin kontrolleri (veritabanı okur, bu yüzden senkron; iş parçacığında çalışır)."""
    return check_ai_allowed(db, shop.workspace_id, user)


async def require_ai_enabled(scope: Scope = Depends(_ai_allowed)):
    """Yapay zekâ kullanan uç noktalara `dependencies=[Depends(require_ai_enabled)]` olarak eklenir. Çalışma alanı AI'ı
    kapattıysa, istek sınırı aşıldıysa ya da kredi bittiyse içerik sağlayıcıya gitmeden reddeder. Geçerse isteğin
    çalışma alanını ölçüm bağlamına yazar (billing/metering.py): AI çağrıları kullanımı bu hesaba kaydeder. Async olması
    bilerek: bağlam değişkeni yalnızca olay döngüsünde atanınca senkron uç noktanın iş parçacığına geçer."""
    set_scope(scope)
    # Aynı çalışma alanından aynı anda en fazla AI_MAX_CONCURRENT iş: görsel/PDF/video işleri belleği şişirir ve kredi
    # istek bittikten sonra düşüldüğü için paralel istekler bakiyenin altına inebilir.
    if not _ai_inflight.acquire(scope.workspace_id):
        raise HTTPException(429, tr("Aynı anda çok fazla yapay zekâ işlemi çalışıyor. Biri bitince tekrar dene.", "Too many AI actions are running at once. Try again when one finishes."))
    try:
        yield
    finally:
        _ai_inflight.release(scope.workspace_id)


AI_MAX_CONCURRENT = 4
_ai_inflight = Concurrency(AI_MAX_CONCURRENT)
AI_WINDOW_SECONDS = 600
AI_MAX_CALLS = 60
_ai_hits: dict[int, deque[float]] = defaultdict(deque)

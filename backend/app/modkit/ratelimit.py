"""Bellek içi kayan pencere hız sınırlayıcı. Tek uygulama kopyası için yeterli; ölçeklenince (bkz. ölçekleme planı)
Redis'e taşınır — çağrı noktaları değişmez.

Kullanım: `hit("invite.send", f"ws:{ws_id}", limit=20, window=3600)` aşılırsa 429 fırlatır."""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException

from app.core.i18n import tr

_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def check(bucket: str, key: str, limit: int, window: float) -> bool:
    """İzin varsa sayar ve True döner; sınır dolduysa False (saymaz)."""
    now = time.time()
    with _lock:
        q = _hits[(bucket, key)]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True


def hit(bucket: str, key: str, limit: int, window: float) -> None:
    if not check(bucket, key, limit, window):
        raise HTTPException(429, tr("Çok fazla istek gönderildi. Biraz sonra tekrar dene.", "Too many requests. Try again in a little while."))


def reset() -> None:
    """Testler için."""
    with _lock:
        _hits.clear()

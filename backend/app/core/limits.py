"""İstek sınırları. Bellek içidir (tek sunucu kopyası için yeterli); birden fazla kopyaya çıkınca Redis'e taşınmalı —
çağıranlar yalnızca `hit` / `acquire` / `release` kullandığı için yalnızca bu dosya değişir."""
import threading
import time
from collections import defaultdict, deque


class SlidingWindow:
    """Anahtar başına, son `window` saniyede en fazla `limit` olay."""

    def __init__(self, limit: int, window: int):
        self.limit, self.window = limit, window
        self._hits: dict[object, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._swept = time.monotonic()

    def hit(self, key) -> bool:
        """Olayı sayar. Sınır aşıldıysa saymadan False döner."""
        now = time.monotonic()
        with self._lock:
            if now - self._swept > self.window:  # boşta kalan anahtarlar birikmesin
                self._swept = now
                for k in [k for k, q in self._hits.items() if not q or now - q[-1] > self.window]:
                    del self._hits[k]
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


class Concurrency:
    """Anahtar başına aynı anda en fazla `limit` iş."""

    def __init__(self, limit: int):
        self.limit = limit
        self._active: dict[object, int] = defaultdict(int)
        self._lock = threading.Lock()

    def acquire(self, key) -> bool:
        with self._lock:
            if self._active[key] >= self.limit:
                return False
            self._active[key] += 1
            return True

    def release(self, key) -> None:
        with self._lock:
            self._active[key] -= 1
            if self._active[key] <= 0:
                del self._active[key]

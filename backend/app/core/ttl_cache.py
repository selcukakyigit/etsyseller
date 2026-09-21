"""Referans veriler (kargo profilleri, kategori özellikleri…) için süreç içi önbellek.
Düzenleme ekranı her açıldığında Etsy'ye istek atmasın; "Etsy ile senkronize et" temizler."""

import threading
import time
from typing import Any, Callable

_lock = threading.Lock()
_store: dict[tuple, tuple[float, Any]] = {}
TTL_SECONDS = 6 * 3600


def cached(key: tuple, loader: Callable[[], Any]) -> Any:
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit and now - hit[0] < TTL_SECONDS:
            return hit[1]
    value = loader()
    with _lock:
        _store[key] = (now, value)
    return value


def clear(prefix: tuple = ()) -> None:
    with _lock:
        for k in [k for k in _store if k[: len(prefix)] == prefix]:
            del _store[k]

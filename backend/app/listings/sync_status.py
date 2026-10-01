import threading

_lock = threading.Lock()
_syncing: set[int] = set()
# Yüzdelik ilerleme çubuğu için: {shop_id: (işlenen, toplam)}. Senkron bitince/başarısız olunca temizlenir.
_progress: dict[int, tuple[int, int]] = {}


def is_syncing(shop_id: int) -> bool:
    with _lock:
        return shop_id in _syncing


def mark_syncing(shop_id: int) -> bool:
    """Returns False (no-op for the caller) if a sync for this shop is already running."""
    with _lock:
        if shop_id in _syncing:
            return False
        _syncing.add(shop_id)
        _progress.pop(shop_id, None)
        return True


def mark_done(shop_id: int) -> None:
    with _lock:
        _syncing.discard(shop_id)
        _progress.pop(shop_id, None)


def set_progress(shop_id: int, done: int, total: int) -> None:
    with _lock:
        _progress[shop_id] = (done, total)


def get_progress(shop_id: int) -> tuple[int, int] | None:
    with _lock:
        return _progress.get(shop_id)

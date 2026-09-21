import threading

_lock = threading.Lock()
_syncing: set[int] = set()


def is_syncing(shop_id: int) -> bool:
    with _lock:
        return shop_id in _syncing


def mark_syncing(shop_id: int) -> bool:
    """Returns False (no-op for the caller) if a sync for this shop is already running."""
    with _lock:
        if shop_id in _syncing:
            return False
        _syncing.add(shop_id)
        return True


def mark_done(shop_id: int) -> None:
    with _lock:
        _syncing.discard(shop_id)

"""Kullanım ölçümü: önbellek isabeti/ıskası, reddedilme nedenleri, aranan kelimeler. Her istekte veritabanına yazılmaz: süreç içi sayaç tutulur,
dakikalık worker turunda (`flush`) toplu yazılır. Yalnızca sayı saklanır, mağaza kimliği yoktur."""
import datetime as dt
import threading
import time
from collections import Counter

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.research.models import SearchDaily, UsageDaily

_lock = threading.Lock()
_events: Counter = Counter()  # (gün, olay) -> sayı
_searches: Counter = Counter()  # (gün, kelime, pazar) -> arama sayısı
_empty: Counter = Counter()  # aynı anahtar -> sonuçsuz kalan arama sayısı
_MAX_KEYS = 5000  # bellek sınırı: yazılamayan (veritabanı hatası) sayaçlar sonsuza dek birikmesin

# Olay adları (bir yerde): panel bunlardan oran hesaplar. VOLUME_*: kelime başına hacim bakışı (editör, asistan);
# SEARCH_*: Keşfet araması ilk bakışta havuzdan karşılandı mı (hit), eski veriyle mi (stale), sağlayıcı gerekti mi (miss).
VOLUME_FRESH, VOLUME_STALE, VOLUME_MISS = "volume_fresh", "volume_stale", "volume_miss"
SEARCH_HIT, SEARCH_STALE, SEARCH_MISS = "search_hit", "search_stale", "search_miss"
REFUSED_PREFIX = "refused:"

_ONCE_WINDOW = 120.0  # sn: ekran sonuç gelene kadar aynı aramayı yoklar; bu süre içindeki tekrarlar tek arama sayılır
_seen: dict[tuple, float] = {}


def _today() -> dt.date:
    return dt.datetime.utcnow().date()


def once(key: tuple) -> bool:
    """`key` son `_ONCE_WINDOW` saniyede görülmediyse True (ve görüldü işaretler). Yoklamaları tek arama saymak için."""
    now = time.monotonic()
    with _lock:
        if len(_seen) > 2000:
            for k in [k for k, t in _seen.items() if now - t > _ONCE_WINDOW]:
                del _seen[k]
        last = _seen.get(key)
        _seen[key] = now
        return last is None or now - last > _ONCE_WINDOW


def count(event: str, n: int = 1) -> None:
    if n <= 0:
        return
    with _lock:
        if len(_events) < _MAX_KEYS:
            _events[(_today(), event)] += n


def search(term: str, market: str, empty: bool, new: bool = True) -> None:
    """Bir Keşfet aramasını sayar; `empty`: kullanıcı sonuç göremedi (sonuçsuz ya da kota/bütçe nedeniyle reddedildi).
    `new=False`: arama zaten sayılmıştı, yalnızca sonradan sonuçsuz çıktığı işlenir."""
    key = (_today(), term[:120], market)
    with _lock:
        if len(_searches) + len(_empty) < _MAX_KEYS or key in _searches or key in _empty:
            if new:
                _searches[key] += 1
            if empty:
                _empty[key] += 1


def reset() -> None:
    with _lock:
        _events.clear()
        _searches.clear()
        _empty.clear()
        _seen.clear()


def _take() -> tuple[Counter, Counter, Counter]:
    global _events, _searches, _empty
    with _lock:
        taken = (_events, _searches, _empty)
        _events, _searches, _empty = Counter(), Counter(), Counter()
    return taken


def _bump(db: Session, model, keys: dict, **add: int) -> None:
    """Satır varsa sayaçlarını artırır, yoksa ekler (eşzamanlı ekleme çakışması bir kez yeniden denenir)."""
    for attempt in range(2):
        row = db.scalar(select(model).filter_by(**keys))
        if row is not None:
            for field, value in add.items():
                setattr(row, field, (getattr(row, field) or 0) + value)
            return
        try:
            with db.begin_nested():
                db.add(model(**keys, **add))
            return
        except IntegrityError:
            if attempt:
                raise


def flush(db: Session) -> int:
    """Birikmiş sayaçları yazar; yazılan satır sayısını döner. Hata olursa sayaçlar kaybolmaz (geri eklenir)."""
    events, searches, empty = _take()
    if not events and not searches and not empty:
        return 0
    try:
        for (day, event), n in events.items():
            _bump(db, UsageDaily, {"day": day, "event": event}, n=n)
        for day, term, market in set(searches) | set(empty):
            _bump(db, SearchDaily, {"day": day, "term": term, "market": market}, n=searches.get((day, term, market), 0), empty=empty.get((day, term, market), 0))
        db.commit()
    except Exception:
        db.rollback()
        with _lock:
            _events.update(events)
            _searches.update(searches)
            _empty.update(empty)
        raise
    return len(events) + len(set(searches) | set(empty))

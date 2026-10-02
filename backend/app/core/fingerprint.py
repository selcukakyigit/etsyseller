"""Bir mağazanın tablo içeriğinin ucuz parmak izi: satır sayısı + her satırın tam metninin hash'lerinin toplamı.

Ağır hesapların (listing listesi, finans raporu) sonucunu bellekte tutmak için kullanılır: parmak izi aynıysa veri
değişmemiştir ve önbellekteki sonuç doğrudur. Hangi kodun tabloya yazdığından bağımsız çalışır, ayrıca "önbelleği
sil" çağrısı gerekmez. Hash'i Postgres hesaplar (veri uygulamaya taşınmaz). SQLite'ta None döner; önbellek kapanır."""
import threading
from collections import OrderedDict

from sqlalchemy import text
from sqlalchemy.orm import Session


def table_fingerprint(db: Session, table: str, shop_id: int) -> tuple | None:
    if db.get_bind().dialect.name != "postgresql":
        return None
    # Tablo adı yalnızca koddan gelir (kullanıcı girdisi değil).
    return tuple(db.execute(text(f"SELECT count(*), coalesce(sum(hashtext(t::text)::bigint), 0) FROM {table} t WHERE t.shop_id = :s"), {"s": shop_id}).one())


def fingerprints(db: Session, tables: tuple[str, ...], shop_id: int) -> tuple | None:
    parts = [table_fingerprint(db, t, shop_id) for t in tables]
    return None if any(p is None for p in parts) else tuple(parts)


class ResultCache:
    """İş parçacığı güvenli, boyutu sınırlı (en eski atılır) sonuç önbelleği."""

    def __init__(self, max_items: int):
        self._items: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        self._max = max_items

    def get(self, key):
        with self._lock:
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key]

    def set(self, key, value) -> None:
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self._max:
                self._items.popitem(last=False)

    def drop_shop(self, shop_id: int) -> None:
        with self._lock:
            for k in [k for k in self._items if k[0] == shop_id]:
                del self._items[k]

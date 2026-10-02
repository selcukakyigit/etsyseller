"""Sipariş geçmişinden aylık satış serileri (listing ve mağaza geneli).

Kaynak `listings.performance._sales_index`: iptaller hariç, listing başına günlük (adet, tutar). İndeks siparişler
değişmedikçe yeniden kurulmadığı için buradaki hesaplar ucuzdur."""
import datetime as dt
from collections import defaultdict

from sqlalchemy.orm import Session

from app.listings import performance
from app.shops.models import Shop


def ym(d: dt.date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def add_months(key: str, n: int) -> str:
    y, m = int(key[:4]), int(key[5:])
    i = y * 12 + (m - 1) + n
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def month_range(end_key: str, count: int) -> list[str]:
    """`end_key` dahil geriye doğru `count` ay, eskiden yeniye."""
    return [add_months(end_key, -i) for i in range(count - 1, -1, -1)]


def index(db: Session, shop: Shop) -> dict[int, list[tuple[dt.date, int, float]]]:
    return performance._sales_index(db, shop)


def monthly(rows: list[tuple[dt.date, int, float]]) -> dict[str, list[float]]:
    """ay -> [adet, tutar]"""
    out: dict[str, list[float]] = defaultdict(lambda: [0, 0.0])
    for day, units, revenue in rows:
        cell = out[ym(day)]
        cell[0] += units
        cell[1] += revenue
    return dict(out)


def shop_monthly(idx: dict[int, list[tuple[dt.date, int, float]]]) -> dict[str, list[float]]:
    out: dict[str, list[float]] = defaultdict(lambda: [0, 0.0])
    for rows in idx.values():
        for key, (u, r) in monthly(rows).items():
            out[key][0] += u
            out[key][1] += r
    return dict(out)


def units_between(rows: list[tuple[dt.date, int, float]], start: dt.date, end: dt.date) -> int:
    return sum(u for day, u, _ in rows if start <= day <= end)


def shop_units_between(idx: dict[int, list[tuple[dt.date, int, float]]], start: dt.date, end: dt.date) -> int:
    return sum(units_between(rows, start, end) for rows in idx.values())

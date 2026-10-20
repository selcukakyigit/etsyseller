"""Sipariş geçmişinden aylık satış serileri (listing ve mağaza geneli).

Kaynak `listings.performance._sales_index`: iptaller hariç, listing başına günlük (adet, tutar). İndeks siparişler
değişmedikçe yeniden kurulmadığı için buradaki hesaplar ucuzdur."""
import datetime as dt
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.listings import performance
from app.listings.models import ListingStatSnapshot
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


STAT_TOLERANCE_DAYS = 3  # ay başına en çok bu kadar gün uzaklıktaki günlük kayıt "ay başı değeri" sayılır


def _stat_deltas(db: Session, shop: Shop, today: dt.date) -> dict[int, dict[str, int | None]]:
    """Listing başına bu ay ve geçen ayın görüntülenme/favori artışı. Etsy yalnızca ömür boyu toplamı verir; aylık değer, günlük kayıtların
    (jobs/daily_stats.py) ay başlarındaki farkından hesaplanır. Kayıt geçmişi o aya yetmiyorsa değer None'dır (uydurulmaz)."""
    this_start = today.replace(day=1)
    prev_start = dt.date.fromisoformat(add_months(ym(today), -1) + "-01")
    since = dt.datetime.combine(prev_start - dt.timedelta(days=STAT_TOLERANCE_DAYS), dt.time.min)
    series: dict[int, list[tuple[dt.date, int, int]]] = {}
    for listing_id, captured_at, views, favorites in db.execute(
        select(ListingStatSnapshot.listing_id, ListingStatSnapshot.captured_at, ListingStatSnapshot.views, ListingStatSnapshot.favorites)
        .where(ListingStatSnapshot.shop_id == shop.id, ListingStatSnapshot.captured_at >= since)
        .order_by(ListingStatSnapshot.listing_id, ListingStatSnapshot.captured_at)
    ):
        series.setdefault(listing_id, []).append((captured_at.date(), views or 0, favorites or 0))

    def near(rows: list[tuple[dt.date, int, int]], day: dt.date) -> tuple[dt.date, int, int] | None:
        best = min(rows, key=lambda r: abs((r[0] - day).days))
        return best if abs((best[0] - day).days) <= STAT_TOLERANCE_DAYS else None

    out: dict[int, dict[str, int | None]] = {}
    for listing_id, rows in series.items():
        now, m0, p0 = rows[-1], near(rows, this_start), near(rows, prev_start)
        cell: dict[str, int | None] = {"views_this": None, "views_last": None, "favs_this": None, "favs_last": None}
        if m0 is not None:
            cell["views_this"], cell["favs_this"] = max(0, now[1] - m0[1]), max(0, now[2] - m0[2])
            if p0 is not None:
                cell["views_last"], cell["favs_last"] = max(0, m0[1] - p0[1]), max(0, m0[2] - p0[2])
        out[listing_id] = cell
    return out


def card_summary(db: Session, shop: Shop, today: dt.date) -> dict:
    """Liste kartı için listing başına özet: satış adedi (bu ay, geçen ay, toplam; iptaller hariç) ve görüntülenme/favori artışı (bu ay, geçen ay)."""
    this_key = ym(today)
    last_key = add_months(this_key, -1)
    empty_stats: dict[str, int | None] = {"views_this": None, "views_last": None, "favs_this": None, "favs_last": None}
    stats = _stat_deltas(db, shop, today)
    out: dict[str, dict[str, int | None]] = {}
    for listing_id, rows in index(db, shop).items():
        by_month = monthly(rows)
        out[str(listing_id)] = {
            "this_month": int(by_month.get(this_key, [0])[0]), "last_month": int(by_month.get(last_key, [0])[0]), "total": int(sum(u for u, _ in by_month.values())),
            **stats.get(listing_id, empty_stats),
        }
    for listing_id, cell in stats.items():  # satışı olmayan ama kayıtlı listing'ler de görüntülenme/favori alır
        out.setdefault(str(listing_id), {"this_month": 0, "last_month": 0, "total": 0, **cell})
    return {"month": this_key, "listings": out}


def units_between(rows: list[tuple[dt.date, int, float]], start: dt.date, end: dt.date) -> int:
    return sum(u for day, u, _ in rows if start <= day <= end)


def shop_units_between(idx: dict[int, list[tuple[dt.date, int, float]]], start: dt.date, end: dt.date) -> int:
    return sum(units_between(rows, start, end) for rows in idx.values())

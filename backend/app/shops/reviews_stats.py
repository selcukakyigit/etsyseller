"""Yorum istatistikleri (bkz. router.py GET /{shop_id}/reviews/stats). Yalnızca yerelden okur, Etsy'ye
istek atmaz — ham veri jobs/reviews.py ile günlük senkronize ediliyor. Etsy'nin döndürdüğü ham sayılar
neyse o gösterilir (tekilleştirme yok) — kullanıcı tercihiyle basit tutuldu."""
import datetime as dt
import html
from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.listings.models import ListingCache
from app.shops.models import ReviewCache, Shop

TOP_N = 8
MIN_FOR_TOP_RATED = 3  # tek bir 5 yıldızlı yorumla "en sevilen" listesine girmesin
MONTHS = 12


def _titles(db: Session, shop_id: int, listing_ids: set[int]) -> dict[int, str]:
    if not listing_ids:
        return {}
    rows = db.execute(
        select(ListingCache.listing_id, ListingCache.title).where(
            ListingCache.shop_id == shop_id, ListingCache.listing_id.in_(listing_ids)
        )
    ).all()
    return {lid: html.unescape(title or "") for lid, title in rows}


def build_stats(db: Session, shop: Shop) -> dict:
    rows = list(db.scalars(select(ReviewCache).where(ReviewCache.shop_id == shop.id)))

    by_listing: dict[int, list[int]] = defaultdict(list)
    for r in rows:
        by_listing[r.listing_id].append(r.rating)

    titles = _titles(db, shop.id, set(by_listing))

    def entry(lid: int, ratings: list[int]) -> dict:
        return {
            "listing_id": lid,
            "title": titles.get(lid),
            "count": len(ratings),
            "average": round(sum(ratings) / len(ratings), 2),
        }

    top_reviewed = sorted((entry(lid, r) for lid, r in by_listing.items()), key=lambda e: -e["count"])[:TOP_N]
    top_rated = sorted(
        (entry(lid, r) for lid, r in by_listing.items() if len(r) >= MIN_FOR_TOP_RATED),
        key=lambda e: (-e["average"], -e["count"]),
    )[:TOP_N]

    distribution = Counter(r.rating for r in rows)

    today = dt.date.today()
    month_keys = []
    y, m = today.year, today.month
    for _ in range(MONTHS):
        month_keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    month_keys.reverse()
    monthly_ratings: dict[str, list[int]] = defaultdict(list)
    for r in rows:
        key = r.created_at.strftime("%Y-%m")
        if key in month_keys:
            monthly_ratings[key].append(r.rating)
    monthly = [
        {
            "month": k,
            "count": len(monthly_ratings.get(k, [])),
            "average": round(sum(monthly_ratings[k]) / len(monthly_ratings[k]), 2) if monthly_ratings.get(k) else None,
        }
        for k in month_keys
    ]

    return {
        "top_reviewed": top_reviewed,
        "top_rated": top_rated,
        "rating_distribution": {str(i): distribution.get(i, 0) for i in range(5, 0, -1)},
        "monthly": monthly,
    }

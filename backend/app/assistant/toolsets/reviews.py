"""Müşteri yorumları (Yorumlar sayfasıyla aynı yerel veri; günlük senkronize edilir, Etsy'ye istek atmaz).
Alıcı kimliği modele verilmez. Etsy API'si yorumlara cevap yazmaya izin vermez."""
import datetime as dt
import html

from sqlalchemy import func, select

from app.listings.models import ListingCache
from app.shops import reviews_stats
from app.shops.models import ReviewCache

MAX_LIMIT = 30
TEXT_CHARS = 400


def shop_reviews(ctx, a: dict) -> dict:
    q = select(ReviewCache).where(ReviewCache.shop_id == ctx.shop.id)
    if a.get("listing_id"):
        q = q.where(ReviewCache.listing_id == int(a["listing_id"]))
    if a.get("max_rating"):
        q = q.where(ReviewCache.rating <= int(a["max_rating"]))
    if a.get("min_rating"):
        q = q.where(ReviewCache.rating >= int(a["min_rating"]))
    if a.get("since"):
        q = q.where(ReviewCache.created_at >= dt.datetime.fromisoformat(str(a["since"])))
    if a.get("with_text", True):
        q = q.where(func.length(ReviewCache.review) > 0)
    if a.get("query"):
        q = q.where(func.lower(ReviewCache.review).contains(str(a["query"]).lower()))
    sub = q.subquery()  # sayım alt sorgunun KENDİ sütunundan: ReviewCache.rating kullanılırsa kartezyen çarpım olur
    total, avg = ctx.db.execute(select(func.count(), func.avg(sub.c.rating))).one()
    rows = ctx.db.scalars(q.order_by(ReviewCache.created_at.desc()).limit(max(1, min(int(a.get("limit") or 15), MAX_LIMIT)))).all()
    titles = dict(ctx.db.execute(select(ListingCache.listing_id, ListingCache.title).where(
        ListingCache.shop_id == ctx.shop.id, ListingCache.listing_id.in_({r.listing_id for r in rows})
    )).all())
    stats = reviews_stats.build_stats(ctx.db, ctx.shop)
    return {
        "magaza_geneli": {"yildiz_dagilimi": stats.get("distribution"), "aylik_son_12": stats.get("monthly")},
        "filtreye_uyan": total or 0,
        "ortalama": round(float(avg), 2) if avg is not None else None,
        "yorumlar": [
            {
                "listing_id": r.listing_id, "urun": html.unescape(titles.get(r.listing_id) or "")[:70], "yildiz": r.rating,
                "tarih": r.created_at.date().isoformat(), "metin": (r.review or "")[:TEXT_CHARS], "dil": r.language,
            }
            for r in rows
        ],
        "not": "Şikâyet/övgü temalarını yorum metinlerinden çıkar, ürün adıyla örnek ver. Yorumlara cevap Etsy API'siyle yazılamaz; kullanıcı Etsy'den yazar.",
    }


TOOLS: list[dict] = [
    {
        "name": "shop_reviews",
        "description": "Müşteri yorumları: yıldız dağılımı, aylık trend ve filtreye uyan yorum metinleri (en yeniden). 'Ne şikâyet ediyorlar' için max_rating=3; belirli ürün için listing_id; metinde kelime için query; tarih için since (YYYY-MM-DD).",
        "input_schema": {"type": "object", "properties": {
            "listing_id": {"type": "integer"}, "max_rating": {"type": "integer"}, "min_rating": {"type": "integer"},
            "since": {"type": "string", "description": "YYYY-MM-DD"}, "query": {"type": "string"}, "with_text": {"type": "boolean"}, "limit": {"type": "integer"},
        }, "required": []},
    },
]
EXECUTORS = {"shop_reviews": shop_reviews}
LABELS = {"shop_reviews": "Yorumları okuyor"}
LABELS_EN = {"shop_reviews": "Reading reviews"}

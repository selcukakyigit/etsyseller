"""Etsy aramasındaki sıra takibinin mağaza geneli özeti (tek ilan için tools.track_keywords). Yalnızca yerel ölçümleri
okur, Etsy'ye istek atmaz. Değişim pozitifse sıra yükselmiş (numara küçülmüş) demektir."""
import html

from sqlalchemy import select

from app.insights import rank
from app.listings.models import ListingCache


def rank_overview(ctx, a: dict) -> dict:
    db, shop = ctx.db, ctx.shop
    ids = rank.tracked_listing_ids(db, shop)
    if not ids:
        return {"takip_edilen_ilan": 0, "not": "Sıra takibi yok. track_keywords ile bir ilana arama ekleyebilirsin."}
    titles = dict(db.execute(select(ListingCache.listing_id, ListingCache.title).where(ListingCache.shop_id == shop.id, ListingCache.listing_id.in_(ids))).all())
    rows = []
    for lid in ids:
        for k in rank.listing_ranks(db, shop, lid, today=ctx.today)["keywords"]:
            rows.append({
                "listing_id": lid, "urun": html.unescape(titles.get(lid) or "")[:60], "arama": k["keyword"], "sira": k["position"],
                "degisim_7g": k["change_7d"], "degisim_30g": k["change_30d"], "olculdu": k["measured"], "rakip": k["total_results"],
            })
    window = "degisim_7g" if a.get("period") == "7d" else "degisim_30g"
    measured = [r for r in rows if r[window] is not None]
    limit = max(1, min(int(a.get("limit") or 10), 25))
    return {
        "takip_edilen_ilan": len(ids), "takip_edilen_arama": len(rows), "donem": window,
        "en_cok_dusen": sorted((r for r in measured if r[window] < 0), key=lambda r: r[window])[:limit],
        "en_cok_yukselen": sorted((r for r in measured if r[window] > 0), key=lambda r: -r[window])[:limit],
        "ilk_sayfalarda_yok": [r for r in rows if r["olculdu"] and r["sira"] is None][:limit],
        "henuz_olculmedi": sum(1 for r in rows if not r["olculdu"]),
        "not": f"sira=None: ilk {rank.MAX_RESULTS} sonuçta yok. Değişim için en az iki ölçüm gerekir. Düşüşte listing_diagnosis ile sebebe bak.",
    }


TOOLS: list[dict] = [
    {
        "name": "rank_overview",
        "description": "Sıra takibindeki TÜM ilanların Etsy arama sırası özeti: en çok düşen/yükselen aramalar ve ilk sayfalarda görünmeyenler. 'Hangi kelimede düştüm', 'sıralamam nasıl' soruları için. Tek ilan için track_keywords.",
        "input_schema": {"type": "object", "properties": {"period": {"type": "string", "enum": ["7d", "30d"]}, "limit": {"type": "integer"}}, "required": []},
    },
]
EXECUTORS = {"rank_overview": rank_overview}
LABELS = {"rank_overview": "Sıralamalara bakıyor"}
LABELS_EN = {"rank_overview": "Checking search rankings"}

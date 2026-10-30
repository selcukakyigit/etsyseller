"""Yönetim > Mağazalar: bütün mağazalar, sahibi, bağlantı durumu ve son senkron. Yalnızca okur."""
import datetime as dt

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.admin.deps import escape_like
from app.admin.schemas import ShopRowOut, ShopsPageOut
from app.auth.models import User
from app.core.dates import iso
from app.listings.models import ListingCache
from app.shops.models import OAuthToken, Shop

MAX_PAGE = 100
# Etsy kuralı: ilan verisi en fazla 6 saat eski gösterilebilir (bkz. Shop.listings_synced_at).
STALE_AFTER = dt.timedelta(hours=6)


def list_shops(db: Session, q: str = "", status: str = "", limit: int = 50, offset: int = 0) -> ShopsPageOut:
    """`status`: connected | revoked | demo | stale (bağlı ama senkronu 6 saatten eski) | never (hiç senkronlanmamış)."""
    stmt = (
        select(Shop, User.email, OAuthToken.shop_id)
        .join(User, User.id == Shop.user_id)
        .outerjoin(OAuthToken, OAuthToken.shop_id == Shop.id)
    )
    live = (OAuthToken.shop_id.is_not(None), Shop.access_revoked_at.is_(None), Shop.is_demo.is_(False))
    if status == "connected":
        stmt = stmt.where(*live)
    elif status == "revoked":
        stmt = stmt.where(Shop.access_revoked_at.is_not(None))
    elif status == "demo":
        stmt = stmt.where(Shop.is_demo.is_(True))
    elif status == "stale":
        stmt = stmt.where(*live, Shop.listings_synced_at.is_not(None), Shop.listings_synced_at < dt.datetime.utcnow() - STALE_AFTER)
    elif status == "never":
        stmt = stmt.where(*live, Shop.listings_synced_at.is_(None))
    if q.strip():
        pattern = f"%{escape_like(q.strip().lower())}%"
        stmt = stmt.where(or_(func.lower(Shop.shop_name).like(pattern, escape="\\"), func.lower(User.email).like(pattern, escape="\\")))
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.execute(stmt.order_by(Shop.id.desc()).limit(max(1, min(limit, MAX_PAGE))).offset(max(0, offset))).all()

    now = dt.datetime.utcnow()
    ids = [shop.id for shop, _, _ in rows]
    counts = dict(db.execute(select(ListingCache.shop_id, func.count(ListingCache.id)).where(ListingCache.shop_id.in_(ids)).group_by(ListingCache.shop_id)).all()) if ids else {}
    return ShopsPageOut(
        total=total,
        items=[
            ShopRowOut(
                id=s.id, shop_name=s.shop_name, etsy_shop_id=s.etsy_shop_id, workspace_id=s.workspace_id, owner_id=s.user_id, owner_email=email,
                connected=s.is_demo or (token_shop_id is not None and s.access_revoked_at is None), revoked_at=iso(s.access_revoked_at),
                is_demo=s.is_demo, connected_at=iso(s.connected_at), listings_synced_at=iso(s.listings_synced_at), listing_count=int(counts.get(s.id, 0)),
                stale=not s.is_demo and token_shop_id is not None and s.access_revoked_at is None and (s.listings_synced_at is None or s.listings_synced_at < now - STALE_AFTER),
            )
            for s, email, token_shop_id in rows
        ],
    )

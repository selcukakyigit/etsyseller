import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.finance import service as fin_service
from app.shops import reference_cache
from app.etsy import shipping as etsy_shipping
from app.etsy.client import EtsyAuthError, EtsyClient
from app.listings.models import ListingCache
from app.shops import service
from app.shops import shipping_admin as admin
from app.shops.shipping_admin import ProcessingProfileIn, ReturnPolicyIn, ShippingProfileIn, ShopSectionIn
from app.shops.deps import get_owned_shop
from app.shops.models import Shop
from app.shops.schemas import ShopOut

router = APIRouter(prefix="/api/shops", tags=["shops"])


@router.get("", response_model=list[ShopOut])
def list_shops(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    shops = db.query(Shop).filter_by(user_id=user.id).all()
    return [
        ShopOut(id=s.id, etsy_shop_id=s.etsy_shop_id, shop_name=s.shop_name, connected=s.oauth_token is not None, currency=s.currency, icon_url=s.icon_url)
        for s in shops
    ]


class CurrencyIn(BaseModel):
    # None = "Otomatik" (siparişlerde en çok geçen para birimi kullanılır); doluysa 3 harfli ISO kod (USD, EUR…).
    currency: str | None = None


@router.put("/{shop_id}/currency")
def set_currency(payload: CurrencyIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    code = payload.currency.strip().upper() if payload.currency else None
    if code and (len(code) != 3 or not code.isalpha()):
        raise HTTPException(400, "Para birimi 3 harfli bir ISO kod olmalı (ör. USD, EUR, TRY).")
    if code:
        # Yalnızca Etsy ödeme hesabından gerçek kur verisi olan para birimleri kabul edilir — başkası sessizce
        # çevrilmeden (kur=1.0) yanlış etiketlenirdi.
        available = fin_service._fx_tables(db, shop)["overall"].keys()
        if code not in available:
            raise HTTPException(400, f"Bu mağazada '{code}' için kur verisi yok. Kullanılabilir: {', '.join(sorted(available)) or 'yok'}.")
    shop.currency = code
    db.commit()
    return {"ok": True, "currency": shop.currency}


@router.get("/connect/start")
def connect_start(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    url = service.start_connect(db, user)
    return RedirectResponse(url)


@router.get("/connect/callback")
def connect_callback(code: str, state: str, db: Session = Depends(get_db)):
    # Etsy redirects the browser here directly (not an XHR call), so we can't
    # depend on get_current_user via a custom header — the OAuthState row
    # already carries the user_id that started the flow.
    try:
        shop = service.complete_connect(db, code, state)
    except service.ShopConnectError as exc:
        raise HTTPException(400, str(exc)) from exc
    return RedirectResponse(f"{settings.frontend_url}/?connected={shop.etsy_shop_id}")


@router.get("/{shop_id}/shipping-profiles")
def shipping_profiles(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        profiles = reference_cache.get_or_fetch(db, shop, "shipping_profiles", lambda: etsy_shipping.list_shipping_profiles(client))
        # Her profili kullanan listing sayısı yerel önbellekten (senkronize edilen listing'ler kadar).
        counts: dict[int, int] = {}
        for raw in db.scalars(select(ListingCache.raw_json).where(ListingCache.shop_id == shop.id)):
            pid = json.loads(raw).get("shipping_profile_id")
            if pid:
                counts[pid] = counts.get(pid, 0) + 1
        return [{**p, "active_listings_count": counts.get(p["shipping_profile_id"], 0)} for p in profiles]
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{shop_id}/return-policies")
def return_policies(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        policies = reference_cache.get_or_fetch(db, shop, "return_policies", lambda: etsy_shipping.list_return_policies(client))
        counts = admin.listing_counts(db, shop, "return_policy_id")
        return [{**p, "active_listings_count": counts.get(p["return_policy_id"], 0)} for p in policies]
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{shop_id}/sections")
def sections(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        return reference_cache.get_or_fetch(db, shop, "sections", lambda: etsy_shipping.list_shop_sections(client))
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.post("/{shop_id}/sections", status_code=201)
def create_shop_section(payload: ShopSectionIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return admin.create_shop_section(db, shop, payload)


@router.put("/{shop_id}/sections/{section_id}")
def update_shop_section(section_id: int, payload: ShopSectionIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return admin.update_shop_section(db, shop, section_id, payload)


@router.delete("/{shop_id}/sections/{section_id}")
def delete_shop_section(section_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    admin.delete_shop_section(db, shop, section_id)
    return {"ok": True}


@router.get("/{shop_id}/profile")
def shop_profile(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Mağaza profili (getShop) — başlık, duyuru, yorum ortalaması/sayısı, favori sayısı, tatil modu, logo.
    Gece job'ı (jobs/shop_profile.py) günlük tazeler; hiç çekilmemişse burada bir kerelik anlık istekle doldurulur."""
    try:
        client = EtsyClient(db, shop)
        from app.etsy import shop as etsy_shop

        return reference_cache.get_or_fetch(db, shop, "shop_profile", lambda: etsy_shop.get_shop(client))
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{shop_id}/reviews")
def shop_reviews(
    listing_id: int | None = None,
    rating: int | None = None,
    month: str | None = None,  # "YYYY-MM" — istatistik grafiklerindeki bara/aya tıklayınca filtrelemek için
    limit: int = 20, offset: int = 0,
    shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db),
):
    """Yerelde biriken yorumlar (jobs/reviews.py günlük senkronize eder) — Etsy'ye istek atmaz. Etsy'nin
    döndürdüğü ham hâliyle gösterilir (tekilleştirme yok)."""
    from sqlalchemy import extract, func, select

    from app.shops.models import ReviewCache

    def apply_filters(query):
        if listing_id is not None:
            query = query.where(ReviewCache.listing_id == listing_id)
        if rating is not None:
            query = query.where(ReviewCache.rating == rating)
        if month is not None:
            y, m = month.split("-")
            query = query.where(extract("year", ReviewCache.created_at) == int(y), extract("month", ReviewCache.created_at) == int(m))
        return query

    q = apply_filters(select(ReviewCache).where(ReviewCache.shop_id == shop.id))

    # NOT: count/avg'ı q'nun subquery'sinden ama ReviewCache.rating'i (orijinal tabloya referans) alarak
    # hesaplamak, ikisi birbirine bağlanmadığı için kartezyen çarpıma yol açıyordu (1340 satır × 1340 satır
    # = 1.795.600 gibi absürt bir "toplam" — sayfalama da buradan patladı). Aynı filtreyi tekrar kullanan,
    # subquery'siz DÜZ bir agregasyon sorgusu bu sorunu ortadan kaldırıyor.
    agg_q = apply_filters(select(func.count(), func.avg(ReviewCache.rating)).where(ReviewCache.shop_id == shop.id))
    total, avg = db.execute(agg_q).one()

    rows = db.scalars(q.order_by(ReviewCache.created_at.desc()).limit(limit).offset(offset)).all()

    return {
        "total": total or 0,
        "average": round(avg, 2) if avg is not None else None,
        "reviews": [
            {
                "transaction_id": r.transaction_id, "listing_id": r.listing_id, "rating": r.rating,
                "review": r.review, "image_url": r.image_url, "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/{shop_id}/reviews/stats")
def shop_review_stats(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """En çok yorum alan / en sevilen listing'ler, yıldız dağılımı, son 12 ayın aylık yorum trendi.
    Yalnızca yerelden okur (jobs/reviews.py günlük senkronize eder), Etsy'ye istek atmaz."""
    from app.shops import reviews_stats

    return reviews_stats.build_stats(db, shop)


@router.get("/{shop_id}/production-partners")
def production_partners(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        return reference_cache.get_or_fetch(db, shop, "production_partners", lambda: etsy_shipping.list_production_partners(client))
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{shop_id}/readiness-state-definitions")
def readiness_state_definitions(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        defs = reference_cache.get_or_fetch(
            db, shop, "readiness_state_definitions", lambda: etsy_shipping.list_readiness_state_definitions(client)
        )
        counts = admin.listing_counts(db, shop, "readiness_state_id")
        return [{**d, "active_listings_count": counts.get(d["readiness_state_id"], 0)} for d in defs]
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


# ---- Mağaza düzeyinde yazma işlemleri (shops_w gerekir; tüm listing'leri etkiler) ----

@router.post("/{shop_id}/readiness-state-definitions", status_code=201)
def create_processing_profile(payload: ProcessingProfileIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return admin.create_processing_profile(db, shop, payload)


@router.put("/{shop_id}/readiness-state-definitions/{profile_id}")
def update_processing_profile(
    profile_id: int, payload: ProcessingProfileIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)
):
    return admin.update_processing_profile(db, shop, profile_id, payload)


@router.delete("/{shop_id}/readiness-state-definitions/{profile_id}")
def delete_processing_profile(profile_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    admin.delete_processing_profile(db, shop, profile_id)
    return {"ok": True}


@router.post("/{shop_id}/return-policies", status_code=201)
def create_return_policy(payload: ReturnPolicyIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return admin.create_return_policy(db, shop, payload)


@router.put("/{shop_id}/return-policies/{policy_id}")
def update_return_policy(
    policy_id: int, payload: ReturnPolicyIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)
):
    return admin.update_return_policy(db, shop, policy_id, payload)


@router.delete("/{shop_id}/return-policies/{policy_id}")
def delete_return_policy(policy_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    admin.delete_return_policy(db, shop, policy_id)
    return {"ok": True}


@router.post("/{shop_id}/shipping-profiles", status_code=201)
def create_shipping_profile(payload: ShippingProfileIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return admin.create_shipping_profile(db, shop, payload)


@router.put("/{shop_id}/shipping-profiles/{profile_id}")
def update_shipping_profile(
    profile_id: int, payload: ShippingProfileIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)
):
    return admin.update_shipping_profile(db, shop, profile_id, payload)


@router.delete("/{shop_id}/shipping-profiles/{profile_id}")
def delete_shipping_profile(profile_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    admin.delete_shipping_profile(db, shop, profile_id)
    return {"ok": True}

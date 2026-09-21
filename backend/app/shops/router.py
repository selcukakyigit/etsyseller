import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.ttl_cache import cached
from app.etsy import shipping as etsy_shipping
from app.etsy.client import EtsyAuthError, EtsyClient
from app.listings.models import ListingCache
from app.shops import service
from app.shops import shipping_admin as admin
from app.shops.shipping_admin import ProcessingProfileIn, ReturnPolicyIn, ShippingProfileIn
from app.shops.deps import get_owned_shop
from app.shops.models import Shop
from app.shops.schemas import ShopOut

router = APIRouter(prefix="/api/shops", tags=["shops"])


@router.get("", response_model=list[ShopOut])
def list_shops(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    shops = db.query(Shop).filter_by(user_id=user.id).all()
    return [
        ShopOut(id=s.id, etsy_shop_id=s.etsy_shop_id, shop_name=s.shop_name, connected=s.oauth_token is not None)
        for s in shops
    ]


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
        profiles = cached((shop.id, "list_shipping_profiles"), lambda: etsy_shipping.list_shipping_profiles(client))
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
        policies = cached((shop.id, "list_return_policies"), lambda: etsy_shipping.list_return_policies(client))
        counts = admin.listing_counts(db, shop, "return_policy_id")
        return [{**p, "active_listings_count": counts.get(p["return_policy_id"], 0)} for p in policies]
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{shop_id}/sections")
def sections(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        return cached((shop.id, "list_shop_sections"), lambda: etsy_shipping.list_shop_sections(client))
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{shop_id}/production-partners")
def production_partners(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        return cached((shop.id, "list_production_partners"), lambda: etsy_shipping.list_production_partners(client))
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{shop_id}/readiness-state-definitions")
def readiness_state_definitions(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        defs = cached(
            (shop.id, "list_readiness_state_definitions"), lambda: etsy_shipping.list_readiness_state_definitions(client)
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

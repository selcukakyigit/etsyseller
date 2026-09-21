from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.ttl_cache import cached
from app.etsy import shipping as etsy_shipping
from app.etsy.client import EtsyAuthError, EtsyClient
from app.shops import service
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
        return cached((shop.id, "list_shipping_profiles"), lambda: etsy_shipping.list_shipping_profiles(client))
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.get("/{shop_id}/return-policies")
def return_policies(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        client = EtsyClient(db, shop)
        return cached((shop.id, "list_return_policies"), lambda: etsy_shipping.list_return_policies(client))
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
        return cached((shop.id, "list_readiness_state_definitions"), lambda: etsy_shipping.list_readiness_state_definitions(client))
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc

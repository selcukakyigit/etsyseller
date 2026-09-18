from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.db import get_db
from app.core.deps import get_current_user
from app.etsy.client import EtsyAuthError
from app.listings import service
from app.listings.schemas import ListingOut, SuggestionOut
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/listings", tags=["listings"])


@router.get("", response_model=list[ListingOut])
def get_listings(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        return service.list_listings(db, shop)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc


@router.post("/{listing_id}/suggest", response_model=SuggestionOut)
def suggest(
    listing_id: int,
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        return service.create_suggestion(db, shop, user.id, listing_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    except service.SuggestionError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/suggestions/{suggestion_id}/apply", response_model=SuggestionOut)
def apply(suggestion_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        return service.apply_suggestion(db, shop, suggestion_id)
    except EtsyAuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    except service.SuggestionNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except service.SuggestionConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/suggestions/{suggestion_id}/dismiss", response_model=SuggestionOut)
def dismiss(suggestion_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        return service.dismiss_suggestion(db, shop, suggestion_id)
    except service.SuggestionNotFound as exc:
        raise HTTPException(404, str(exc)) from exc

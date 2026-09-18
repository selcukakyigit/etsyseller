import datetime as dt
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import seo
from app.etsy import listings as etsy_listings
from app.etsy.client import EtsyClient
from app.listings.models import ListingVersion
from app.listings.schemas import ListingOut, SuggestionOut
from app.shops.models import Shop


class SuggestionError(Exception):
    """AI generation failed (bad Etsy data, malformed model output, etc)."""


class SuggestionNotFound(Exception):
    pass


class SuggestionConflict(Exception):
    """Suggestion exists but is not in the state the operation requires."""


def _serialize_suggestion(row: ListingVersion) -> SuggestionOut:
    return SuggestionOut(
        id=row.id,
        listing_id=row.listing_id,
        original_title=row.original_title,
        original_tags=json.loads(row.original_tags),
        original_description=row.original_description,
        suggested_title=row.suggested_title,
        suggested_tags=json.loads(row.suggested_tags),
        suggested_description=row.suggested_description,
        rationale=row.rationale,
        status=row.status,
        created_at=row.created_at.isoformat(),
    )


def list_listings(db: Session, shop: Shop) -> list[ListingOut]:
    client = EtsyClient(db, shop)
    listings = etsy_listings.list_active_listings(client)

    listing_ids = [item["listing_id"] for item in listings]
    pending = db.scalars(
        select(ListingVersion)
        .where(ListingVersion.shop_id == shop.id)
        .where(ListingVersion.listing_id.in_(listing_ids))
        .where(ListingVersion.status == "pending")
        .order_by(ListingVersion.created_at.desc())
    ).all()
    latest_by_listing: dict[int, ListingVersion] = {}
    for row in pending:
        latest_by_listing.setdefault(row.listing_id, row)

    out = []
    for item in listings:
        suggestion = latest_by_listing.get(item["listing_id"])
        out.append(
            ListingOut(
                listing_id=item["listing_id"],
                title=item["title"],
                tags=item["tags"],
                description=item["description"],
                url=item.get("url"),
                image_url=(item.get("images") or [{}])[0].get("url_170x135"),
                views=item.get("views"),
                favorites=item.get("num_favorers"),
                pending_suggestion=_serialize_suggestion(suggestion) if suggestion else None,
            )
        )
    return out


def create_suggestion(db: Session, shop: Shop, user_id: int, listing_id: int) -> SuggestionOut:
    client = EtsyClient(db, shop)
    listing = etsy_listings.get_listing(client, listing_id)

    try:
        suggestion = seo.generate_seo_suggestion(listing)
    except (ValueError, json.JSONDecodeError) as exc:
        raise SuggestionError(f"SEO önerisi üretilemedi: {exc}") from exc

    row = ListingVersion(
        shop_id=shop.id,
        listing_id=listing_id,
        kind="ai_suggestion",
        original_title=listing["title"],
        original_tags=json.dumps(listing["tags"], ensure_ascii=False),
        original_description=listing["description"],
        suggested_title=suggestion["title"],
        suggested_tags=json.dumps(suggestion["tags"], ensure_ascii=False),
        suggested_description=suggestion["description"],
        rationale=suggestion.get("rationale", ""),
        status="pending",
        created_by=user_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_suggestion(row)


def _get_owned_version(db: Session, shop: Shop, suggestion_id: int) -> ListingVersion:
    row = db.get(ListingVersion, suggestion_id)
    if row is None or row.shop_id != shop.id:
        raise SuggestionNotFound("Öneri bulunamadı")
    return row


def apply_suggestion(db: Session, shop: Shop, suggestion_id: int) -> SuggestionOut:
    row = _get_owned_version(db, shop, suggestion_id)
    if row.status != "pending":
        raise SuggestionConflict(f"Öneri zaten '{row.status}' durumunda")

    client = EtsyClient(db, shop)
    etsy_listings.update_listing(
        client,
        row.listing_id,
        {
            "title": row.suggested_title,
            "tags": json.loads(row.suggested_tags),
            "description": row.suggested_description,
        },
    )

    row.status = "applied"
    row.applied_at = dt.datetime.utcnow()
    db.commit()
    return _serialize_suggestion(row)


def dismiss_suggestion(db: Session, shop: Shop, suggestion_id: int) -> SuggestionOut:
    row = _get_owned_version(db, shop, suggestion_id)
    row.status = "dismissed"
    db.commit()
    return _serialize_suggestion(row)

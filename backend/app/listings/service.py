import datetime as dt
import html
import json
import logging
import threading

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import seo
from app.etsy import images as etsy_images
from app.etsy import inventory as etsy_inventory
from app.etsy import listings as etsy_listings
from app.etsy import personalization as etsy_personalization
from app.etsy import properties as etsy_properties
from app.etsy import variation_images as etsy_variation_images
from app.etsy import videos as etsy_videos
from app.etsy.client import EtsyClient
from app.core import ttl_cache
from app.listings import image_cache
from app.keywords import service as keyword_service
from app.keywords import trends as keyword_trends
from app.listings.models import ListingCache, ListingDraft, ListingLocal, ListingStatSnapshot, ListingVersion
from app.listings.schemas import (
    ImageOrderIn,
    InventoryUpdateIn,
    ListingEditOut,
    ListingHistoryOut,
    ListingOut,
    ListingUpdateIn,
    PersonalizationIn,
    PersonalizationOption,
    PersonalizationOut,
    PersonalizationQuestion,
    PropertyUpdateIn,
    StatSnapshotOut,
    VariationImagesIn,
    SuggestIn,
    SuggestionOut,
)
from app.listings import sync_status
from app.shops.models import Shop

logger = logging.getLogger(__name__)


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
        applied_at=row.applied_at.isoformat() if row.applied_at else None,
    )


def _get_cache_row(db: Session, shop: Shop, listing_id: int) -> ListingCache | None:
    return db.scalars(
        select(ListingCache).where(ListingCache.shop_id == shop.id).where(ListingCache.listing_id == listing_id)
    ).one_or_none()


def _store_extras(client: EtsyClient, row: ListingCache, listing_id: int) -> None:
    """Varyasyon görselleri + kişiselleştirme + görsel dosyaları: senkronizasyonda bir kez alınır,
    sonra düzenleme ekranı bunları yalnızca yerelden okur."""
    try:
        row.variation_images_json = json.dumps(
            etsy_variation_images.get_variation_images(client, listing_id), ensure_ascii=False
        )
        row.personalization_json = json.dumps(
            etsy_personalization.get_personalization(listing_id), ensure_ascii=False
        )
        row.extras_synced = True
    except Exception:
        logger.warning("Extras of listing %s could not be synced", listing_id)
    image_cache.cache_listing_images(row.shop_id, listing_id, json.loads(row.raw_json).get("images") or [])


def _fetch_and_cache_one(db: Session, shop: Shop, client: EtsyClient, listing_id: int) -> ListingCache:
    """Live-fetch a single listing's full detail (used when it's missing from
    the cache — e.g. a listing created after the last sync) and store it,
    rather than forcing a full-shop resync just to open one listing."""
    listing = etsy_listings.get_listing(client, listing_id)
    inventory = etsy_inventory.get_inventory(client, listing_id)
    properties = etsy_properties.get_listing_properties(client, listing_id)

    row = _get_cache_row(db, shop, listing_id)
    if row is None:
        row = ListingCache(shop_id=shop.id, listing_id=listing_id)
        db.add(row)

    row.title = listing.get("title", "")
    row.views = listing.get("views") or 0
    row.favorites = listing.get("num_favorers") or 0
    row.raw_json = json.dumps(listing, ensure_ascii=False)
    row.inventory_json = json.dumps(inventory, ensure_ascii=False)
    row.properties_json = json.dumps(properties, ensure_ascii=False)
    row.synced_at = dt.datetime.utcnow()
    _store_extras(client, row, listing_id)
    db.commit()
    return row


STALE_AFTER = dt.timedelta(days=7)  # değişmemiş görünse bile bu süreden eski önbellek yeniden çekilir


def sync_listings(db: Session, shop: Shop, full: bool = False) -> int:
    """Explicit full refresh — this is the only place that fetches every
    listing's inventory/properties from Etsy; everything else reads the
    cache this fills. Tüm durumlar (aktif, pasif, taslak, süresi dolmuş, tükenmiş) çekilir; Etsy'de silinen
    listing'ler yerelden de kaldırılır. Runs synchronously; called from a background thread
    (see start_background_sync) since a many-listing shop can take minutes.

    Artımlı: Etsy'nin `last_modified_timestamp`'i değişmemiş ve 7 günden yeni önbellekli listing'lerin envanteri,
    özellikleri ve ekstraları yeniden ÇEKİLMEZ (yalnızca başlık/görüntülenme/favori/durum listeden güncellenir).
    `full=True` her şeyi baştan çeker."""
    client = EtsyClient(db, shop)
    listings: list[dict] = []
    complete = True
    for state in etsy_listings.ALL_STATES:
        try:
            listings.extend(etsy_listings.list_listings_by_state(client, state))
        except Exception:
            complete = False  # bir durum çekilemediyse silinenleri temizleme (yanlışlıkla silmeyelim)
            logger.exception("Listing state %s could not be fetched for shop %s", state, shop.id)

    synced = 0
    seen_skipped = 0
    seen: set[int] = set()
    for item in listings:
        listing_id = item["listing_id"]
        seen.add(listing_id)
        existing = _get_cache_row(db, shop, listing_id)

        unchanged = (
            not full
            and existing is not None
            and existing.inventory_json not in ("", "{}")
            and json.loads(existing.raw_json).get("last_modified_timestamp") == item.get("last_modified_timestamp")
            and dt.datetime.utcnow() - existing.synced_at < STALE_AFTER
        )
        if unchanged:
            # Sadece listeden gelen hafif alanlar; ağır çağrılar (envanter, özellikler, ekstralar) atlanır.
            existing.title = item.get("title", "")
            existing.views = item.get("views") or 0
            existing.favorites = item.get("num_favorers") or 0
            existing.raw_json = json.dumps(item, ensure_ascii=False)
            seen_skipped += 1
            continue

        try:
            inventory = etsy_inventory.get_inventory(client, listing_id)
            properties = etsy_properties.get_listing_properties(client, listing_id)
        except Exception:
            inventory = json.loads(existing.inventory_json) if existing else {}
            properties = json.loads(existing.properties_json) if existing else []

        row = existing
        if row is None:
            row = ListingCache(shop_id=shop.id, listing_id=listing_id)
            db.add(row)

        row.title = item.get("title", "")
        row.views = item.get("views") or 0
        row.favorites = item.get("num_favorers") or 0
        row.raw_json = json.dumps(item, ensure_ascii=False)
        row.inventory_json = json.dumps(inventory, ensure_ascii=False)
        row.properties_json = json.dumps(properties, ensure_ascii=False)
        row.synced_at = dt.datetime.utcnow()
        # Süresi dolmuş/tükenmiş listing'lerde ek veriler (varyasyon fotoğrafı, kişiselleştirme) açılınca çekilir; API kotasını korur.
        if item.get("state") in ("active", "inactive", "draft"):
            _store_extras(client, row, listing_id)
        synced += 1
        if synced % 25 == 0:
            db.commit()

    if complete:
        for stale in db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id)).all():
            if stale.listing_id not in seen:
                db.delete(stale)
    db.commit()
    logger.info("Listing sync: %s çekildi, %s değişmediği için atlandı (full=%s)", synced, seen_skipped, full)
    return synced


def _run_sync_in_background(shop_id: int, full: bool = False) -> None:
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        shop = db.get(Shop, shop_id)
        if shop is not None and shop.oauth_token is not None:
            sync_listings(db, shop, full=full)
    except Exception:
        logger.exception("Background listing sync failed for shop %s", shop_id)
    finally:
        sync_status.mark_done(shop_id)
        db.close()


def start_background_sync(shop: Shop, full: bool = False) -> bool:
    """Fire-and-forget — returns immediately so the request that triggered it
    (a page's first-ever load, or the navbar sync button) doesn't block for
    however long a full sync takes. Returns False if one's already running."""
    if not sync_status.mark_syncing(shop.id):
        return False
    ttl_cache.clear((shop.id,))
    threading.Thread(target=_run_sync_in_background, args=(shop.id, full), daemon=True).start()
    return True


def get_sync_status(db: Session, shop: Shop) -> dict:
    last_synced_at = db.scalars(
        select(ListingCache.synced_at).where(ListingCache.shop_id == shop.id).order_by(ListingCache.synced_at.desc())
    ).first()
    return {
        "syncing": sync_status.is_syncing(shop.id),
        "last_synced_at": last_synced_at.isoformat() if last_synced_at else None,
    }


_backfilled_shops: set[int] = set()


def _backfill_images_once(shop_id: int) -> None:
    """Senkronizasyon öncesi kalan (görselleri henüz diske indirilmemiş) listing'ler için
    süreç başına bir kez arka planda indirir; böylece kırpıcı ilk açılışta da beklemez."""
    if shop_id in _backfilled_shops:
        return
    _backfilled_shops.add(shop_id)

    def run() -> None:
        from app.core.db import SessionLocal

        db = SessionLocal()
        try:
            for row in db.scalars(select(ListingCache).where(ListingCache.shop_id == shop_id)).all():
                image_cache.cache_listing_images(shop_id, row.listing_id, json.loads(row.raw_json).get("images") or [])
        except Exception:
            logger.exception("Image backfill failed for shop %s", shop_id)
        finally:
            db.close()

    threading.Thread(target=run, daemon=True).start()


def _summary(raw: dict, inventory: dict, over: dict) -> dict:
    """Liste kartı/filtreleri için özet; yerel sürüm varsa onun değerleri öncelikli."""
    inv = over.get("inventory") or inventory or {}
    prices: list[float] = []
    skus: list[str] = []
    currency = None
    qty_props = set(inv.get("quantity_on_property") or [])
    qty_groups: dict[tuple, int] = {}
    for product in inv.get("products") or []:
        if product.get("is_deleted"):
            continue
        if product.get("sku"):
            skus.append(product["sku"])
        # Stok, yalnızca stoğu değiştiren özelliklerin değer kombinasyonu başına bir kez sayılır (Etsy'deki gibi).
        group = tuple(
            sorted(
                (pv.get("property_id"), tuple(pv.get("value_ids") or []))
                for pv in product.get("property_values") or []
                if pv.get("property_id") in qty_props
            )
        )
        for off in product.get("offerings") or []:
            if off.get("is_deleted") or not off.get("is_enabled", True):
                continue
            qty_groups[group] = max(qty_groups.get(group, 0), off.get("quantity") or 0)
            price = off.get("price")
            if isinstance(price, dict) and price.get("divisor"):
                prices.append(price["amount"] / price["divisor"])
                currency = price.get("currency_code") or currency
            elif isinstance(price, (int, float)):
                prices.append(float(price))
    quantity = sum(qty_groups.values())
    if not prices and isinstance(raw.get("price"), dict) and raw["price"].get("divisor"):
        prices = [raw["price"]["amount"] / raw["price"]["divisor"]]
        currency = raw["price"].get("currency_code")
        quantity = raw.get("quantity") or 0

    def pick(key, default=None):
        return over[key] if key in over else raw.get(key, default)

    return {
        "state": raw.get("state"),
        "quantity": quantity,
        "price_min": min(prices) if prices else None,
        "price_max": max(prices) if prices else None,
        "currency": currency,
        "skus": list(dict.fromkeys(skus)),
        "shop_section_id": pick("shop_section_id"),
        "shipping_profile_id": pick("shipping_profile_id"),
        "return_policy_id": pick("return_policy_id"),
        "production_partner_ids": pick("production_partner_ids") or [
            p.get("production_partner_id") for p in raw.get("production_partners") or []
        ],
        "has_video": bool(pick("videos") or []),
        "should_auto_renew": bool(pick("should_auto_renew", False)),
        "ending_timestamp": raw.get("ending_timestamp"),
        "last_modified_timestamp": raw.get("last_modified_timestamp"),
    }


def list_listings(db: Session, shop: Shop) -> list[ListingOut]:
    _backfill_images_once(shop.id)
    rows = db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id)).all()
    listing_ids = [row.listing_id for row in rows]
    pending = db.scalars(
        select(ListingVersion)
        .where(ListingVersion.shop_id == shop.id)
        .where(ListingVersion.listing_id.in_(listing_ids))
        .where(ListingVersion.status == "pending")
        .order_by(ListingVersion.created_at.desc())
    ).all()
    latest_by_listing: dict[int, ListingVersion] = {}
    for version in pending:
        latest_by_listing.setdefault(version.listing_id, version)

    draft_rows = {
        d.listing_id: d
        for d in db.scalars(select(ListingDraft).where(ListingDraft.shop_id == shop.id)).all()
    }
    local_rows = {
        d.listing_id: d
        for d in db.scalars(select(ListingLocal).where(ListingLocal.shop_id == shop.id)).all()
    }

    out = []
    for row in rows:
        raw = json.loads(row.raw_json)
        suggestion = latest_by_listing.get(row.listing_id)

        # Kaydedilmiş yerel sürüm varsa liste Etsy'deki değil onun hâlini gösterir (taslak listeyi değiştirmez).
        draft_row = draft_rows.get(row.listing_id)
        local_row = local_rows.get(row.listing_id)
        draft = json.loads(local_row.data_json) if local_row else {}
        draft_images = sorted(draft.get("images") or [], key=lambda i: i.get("rank", 0))
        image_url = (
            draft_images[0].get("url_170x135") if draft_images else (raw.get("images") or [{}])[0].get("url_170x135")
        )
        out.append(
            ListingOut(
                listing_id=row.listing_id,
                title=html.unescape(draft.get("title", raw.get("title", ""))),
                tags=draft.get("tags", raw.get("tags")) or [],
                description=html.unescape(draft.get("description", raw.get("description", ""))),
                url=raw.get("url"),
                image_url=image_url,
                views=row.views,
                favorites=row.favorites,
                pending_suggestion=_serialize_suggestion(suggestion) if suggestion else None,
                has_draft=draft_row is not None,
                draft_updated_at=draft_row.updated_at.isoformat() if draft_row else None,
                has_local=local_row is not None,
                local_updated_at=local_row.updated_at.isoformat() if local_row else None,
                **_summary(raw, json.loads(row.inventory_json or "{}"), draft),
            )
        )
    from app.listings import creation

    for item in creation.local_summaries(db, shop):
        work, local = item["work"], item["local"]
        out.append(
            ListingOut(
                listing_id=local.listing_id,
                title=work.get("title") or "(Başlıksız yeni listing)",
                tags=work.get("tags") or [],
                description=work.get("description") or "",
                url=None,
                image_url=item["image_url"],
                views=0,
                favorites=0,
                pending_suggestion=None,
                has_local=True,
                local_updated_at=local.updated_at.isoformat(),
                is_new=True,
                **{**_summary({}, work.get("inventory") or {}, work), "state": "draft"},
            )
        )
    return out


def create_suggestion(
    db: Session, shop: Shop, user_id: int, listing_id: int, overrides: SuggestIn | None = None
) -> SuggestionOut:
    if listing_id < 0:
        local = db.scalars(select(ListingLocal).where(ListingLocal.shop_id == shop.id).where(ListingLocal.listing_id == listing_id)).one_or_none()
        listing = json.loads(local.data_json) if local else {}
    else:
        row = _get_cache_row(db, shop, listing_id)
        if row is None:
            row = _fetch_and_cache_one(db, shop, EtsyClient(db, shop), listing_id)
        listing = json.loads(row.raw_json)
    # Formdaki (taslaktaki) güncel değerler verildiyse AI onları iyileştirir.
    if overrides is not None:
        for key, value in overrides.model_dump(exclude_none=True).items():
            listing[key] = value

    keyword_pool = keyword_service.build_keyword_pool(db, shop, listing)

    # Cache-only — never triggers a live Google Trends request here, just
    # opportunistically uses whatever's already cached from a prior
    # "Google Trend Ekle" click (any listing), so this stays fast.
    cached_trends = keyword_trends.get_cached_scores(db, [item["tag"] for item in keyword_pool])
    for item in keyword_pool:
        if item["tag"] in cached_trends:
            item["google_score"] = cached_trends[item["tag"]]

    try:
        suggestion = seo.generate_seo_suggestion(listing, keyword_pool=keyword_pool)
    except (ValueError, json.JSONDecodeError) as exc:
        raise SuggestionError(f"SEO önerisi üretilemedi: {exc}") from exc

    version_row = ListingVersion(
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
    db.add(version_row)
    db.commit()
    db.refresh(version_row)
    out = _serialize_suggestion(version_row)
    out.suggested_materials = suggestion.get("materials", [])
    return out


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
    new_title = row.suggested_title
    new_tags = json.loads(row.suggested_tags)
    new_description = row.suggested_description
    etsy_listings.update_listing(
        client,
        row.listing_id,
        {"title": new_title, "tags": new_tags, "description": new_description},
    )

    cache_row = _get_cache_row(db, shop, row.listing_id)
    if cache_row is not None:
        raw = json.loads(cache_row.raw_json)
        raw["title"] = new_title
        raw["tags"] = new_tags
        raw["description"] = new_description
        cache_row.title = new_title
        cache_row.raw_json = json.dumps(raw, ensure_ascii=False)

    row.status = "applied"
    row.applied_at = dt.datetime.utcnow()
    db.commit()
    return _serialize_suggestion(row)


def dismiss_suggestion(db: Session, shop: Shop, suggestion_id: int) -> SuggestionOut:
    row = _get_owned_version(db, shop, suggestion_id)
    row.status = "dismissed"
    db.commit()
    return _serialize_suggestion(row)


def get_listing_history(db: Session, shop: Shop, listing_id: int) -> ListingHistoryOut:
    versions = db.scalars(
        select(ListingVersion)
        .where(ListingVersion.shop_id == shop.id)
        .where(ListingVersion.listing_id == listing_id)
        .order_by(ListingVersion.created_at.desc())
    ).all()
    stats = db.scalars(
        select(ListingStatSnapshot)
        .where(ListingStatSnapshot.shop_id == shop.id)
        .where(ListingStatSnapshot.listing_id == listing_id)
        .order_by(ListingStatSnapshot.captured_at.asc())
    ).all()
    return ListingHistoryOut(
        versions=[_serialize_suggestion(row) for row in versions],
        stats=[
            StatSnapshotOut(views=row.views, favorites=row.favorites, captured_at=row.captured_at.isoformat())
            for row in stats
        ],
    )


def get_top_categories(db: Session, shop: Shop, limit: int = 5) -> list[dict]:
    counts: dict[int, int] = {}
    for row in db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id)).all():
        tid = json.loads(row.raw_json).get("taxonomy_id")
        if tid:
            counts[tid] = counts.get(tid, 0) + 1
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:limit]
    return [{"taxonomy_id": tid, "count": n} for tid, n in top]


def _unescape(value):
    """Etsy metinleri HTML-escape'li döndürür (&quot; &#39; &amp; …); formda ve karşılaştırmada düz metin kullanılır."""
    if isinstance(value, str):
        return html.unescape(value)
    if isinstance(value, list):
        return [_unescape(v) for v in value]
    if isinstance(value, dict):
        return {k: _unescape(v) for k, v in value.items()}
    return value


def _listing_edit_out(row: ListingCache) -> ListingEditOut:
    raw = json.loads(row.raw_json)
    return ListingEditOut(
        listing_id=row.listing_id,
        # Etsy metni HTML-escape'li döndürür (&#39; gibi); formda düz metin gösterilir.
        title=html.unescape(raw.get("title", "")),
        description=html.unescape(raw.get("description", "")),
        tags=_unescape(raw.get("tags") or []),
        materials=_unescape(raw.get("materials") or []),
        taxonomy_id=raw.get("taxonomy_id"),
        who_made=raw.get("who_made"),
        when_made=raw.get("when_made"),
        is_supply=bool(raw.get("is_supply")),
        shipping_profile_id=raw.get("shipping_profile_id"),
        return_policy_id=raw.get("return_policy_id"),
        images=raw.get("images") or [],
        videos=raw.get("videos") or [],
        inventory=_unescape(json.loads(row.inventory_json or "{}")),
        properties=_unescape(json.loads(row.properties_json or "[]")),
        shop_section_id=raw.get("shop_section_id"),
        featured_rank=raw.get("featured_rank"),
        should_auto_renew=bool(raw.get("should_auto_renew")),
        is_taxable=raw.get("is_taxable", True),
        item_weight=raw.get("item_weight"),
        item_length=raw.get("item_length"),
        item_width=raw.get("item_width"),
        item_height=raw.get("item_height"),
        item_weight_unit=raw.get("item_weight_unit"),
        item_dimensions_unit=raw.get("item_dimensions_unit"),
        production_partner_ids=raw.get("production_partner_ids") or [],
        ecgt_garan_brand=raw.get("ecgt_garan_brand"),
        ecgt_garan_years=raw.get("ecgt_garan_years"),
        ecgt_garan_model=raw.get("ecgt_garan_model"),
        ecgt_garan_guarantee_details=raw.get("ecgt_garan_guarantee_details"),
        ecgt_other_commercial_guarantee_details=raw.get("ecgt_other_commercial_guarantee_details"),
        ecgt_after_sales_service_info=raw.get("ecgt_after_sales_service_info"),
        ecgt_software_update_details=raw.get("ecgt_software_update_details"),
        state=raw.get("state"),
        listing_type=raw.get("listing_type"),
        url=raw.get("url"),
        original_creation_timestamp=raw.get("original_creation_timestamp"),
        ending_timestamp=raw.get("ending_timestamp"),
    )


def get_listing_for_edit(db: Session, shop: Shop, listing_id: int) -> ListingEditOut:
    if listing_id < 0:  # yeni (yerel) listing
        from app.listings import creation

        return creation.edit_from_local(db, shop, listing_id)
    row = _get_cache_row(db, shop, listing_id)
    if row is None:
        row = _fetch_and_cache_one(db, shop, EtsyClient(db, shop), listing_id)
    return _listing_edit_out(row)


def update_listing_property(
    db: Session, shop: Shop, listing_id: int, property_id: int, payload: PropertyUpdateIn
) -> dict:
    client = EtsyClient(db, shop)
    result = etsy_properties.update_listing_property(
        client, listing_id, property_id, payload.value_ids, payload.values, payload.scale_id
    )

    row = _get_cache_row(db, shop, listing_id)
    if row is not None:
        properties = json.loads(row.properties_json or "[]")
        properties = [p for p in properties if p.get("property_id") != property_id]
        properties.append(result)
        row.properties_json = json.dumps(properties, ensure_ascii=False)
        db.commit()

    return result


def delete_listing_property(db: Session, shop: Shop, listing_id: int, property_id: int) -> None:
    client = EtsyClient(db, shop)
    etsy_properties.delete_listing_property(client, listing_id, property_id)

    row = _get_cache_row(db, shop, listing_id)
    if row is not None:
        properties = json.loads(row.properties_json or "[]")
        row.properties_json = json.dumps(
            [p for p in properties if p.get("property_id") != property_id], ensure_ascii=False
        )
        db.commit()


def update_listing_fields(
    db: Session, shop: Shop, user_id: int, listing_id: int, payload: ListingUpdateIn
) -> ListingEditOut:
    row = _get_cache_row(db, shop, listing_id)
    if row is None:
        row = _fetch_and_cache_one(db, shop, EtsyClient(db, shop), listing_id)
    before = json.loads(row.raw_json)

    data = payload.model_dump(exclude_none=True)
    if data:
        client = EtsyClient(db, shop)
        etsy_listings.update_listing(client, listing_id, data)

        # Manual edits join the same append-only history as AI suggestions
        # (kind="manual_edit"), so the listing's timeline stays complete.
        db.add(
            ListingVersion(
                shop_id=shop.id,
                listing_id=listing_id,
                kind="manual_edit",
                original_title=before["title"],
                original_tags=json.dumps(before["tags"], ensure_ascii=False),
                original_description=before["description"],
                suggested_title=data.get("title", before["title"]),
                suggested_tags=json.dumps(data.get("tags", before["tags"]), ensure_ascii=False),
                suggested_description=data.get("description", before["description"]),
                rationale="Manuel düzenleme",
                status="applied",
                created_by=user_id,
                applied_at=dt.datetime.utcnow(),
            )
        )

        # Patch the cache locally from what we just sent, rather than an
        # extra live re-fetch — Etsy's response echoes the same values back.
        before.update(data)
        row.title = before.get("title", row.title)
        row.raw_json = json.dumps(before, ensure_ascii=False)
        db.commit()

    return _listing_edit_out(row)


def update_listing_inventory(db: Session, shop: Shop, listing_id: int, payload: InventoryUpdateIn) -> dict:
    client = EtsyClient(db, shop)
    result = etsy_inventory.update_inventory(client, listing_id, payload.model_dump())

    row = _get_cache_row(db, shop, listing_id)
    if row is not None:
        row.inventory_json = json.dumps(result, ensure_ascii=False)
        db.commit()

    return result


def upload_listing_image(
    db: Session,
    shop: Shop,
    listing_id: int,
    image_bytes: bytes,
    filename: str,
    rank: int | None,
    alt_text: str | None,
) -> dict:
    client = EtsyClient(db, shop)
    result = etsy_images.upload_image(client, listing_id, image_bytes, filename, rank, alt_text)

    row = _get_cache_row(db, shop, listing_id)
    if row is not None:
        raw = json.loads(row.raw_json)
        images = raw.get("images") or []
        images = [img for img in images if img.get("listing_image_id") != result.get("listing_image_id")]
        images.append(result)
        raw["images"] = images
        row.raw_json = json.dumps(raw, ensure_ascii=False)
        db.commit()

    return result


def delete_listing_image(db: Session, shop: Shop, listing_id: int, image_id: int) -> None:
    client = EtsyClient(db, shop)
    etsy_images.delete_image(client, listing_id, image_id)

    row = _get_cache_row(db, shop, listing_id)
    if row is not None:
        raw = json.loads(row.raw_json)
        raw["images"] = [img for img in (raw.get("images") or []) if img.get("listing_image_id") != image_id]
        row.raw_json = json.dumps(raw, ensure_ascii=False)
        db.commit()


def upload_listing_video(db: Session, shop: Shop, listing_id: int, video_bytes: bytes, filename: str) -> dict:
    client = EtsyClient(db, shop)
    result = etsy_videos.upload_video(client, listing_id, video_bytes, filename)

    row = _get_cache_row(db, shop, listing_id)
    if row is not None:
        raw = json.loads(row.raw_json)
        videos = raw.get("videos") or []
        videos = [v for v in videos if v.get("video_id") != result.get("video_id")]
        videos.append(result)
        raw["videos"] = videos
        row.raw_json = json.dumps(raw, ensure_ascii=False)
        db.commit()

    return result


def delete_listing_video(db: Session, shop: Shop, listing_id: int, video_id: int) -> None:
    client = EtsyClient(db, shop)
    etsy_videos.delete_video(client, listing_id, video_id)

    row = _get_cache_row(db, shop, listing_id)
    if row is not None:
        raw = json.loads(row.raw_json)
        raw["videos"] = [v for v in (raw.get("videos") or []) if v.get("video_id") != video_id]
        row.raw_json = json.dumps(raw, ensure_ascii=False)
        db.commit()


def _clean_question(q: dict) -> PersonalizationQuestion:
    """Etsy metinleri HTML-escape'li döndürür (&#39; vb.); formda düz metin tutulur."""
    return PersonalizationQuestion(
        question_id=q.get("question_id"),
        question_text=html.unescape(q.get("question_text") or ""),
        instructions=html.unescape(q.get("instructions") or ""),
        question_type=q.get("question_type") or "text_input",
        required=bool(q.get("required")),
        max_allowed_characters=q.get("max_allowed_characters"),
        max_allowed_files=q.get("max_allowed_files"),
        options=[
            PersonalizationOption(label=html.unescape(o.get("label") or ""), option_id=o.get("option_id"))
            for o in q.get("options") or []
        ],
        add_on_price=q.get("add_on_price"),
    )


def get_listing_personalization(db: Session, shop: Shop, listing_id: int) -> PersonalizationOut:
    if listing_id < 0:
        local = db.scalars(select(ListingLocal).where(ListingLocal.shop_id == shop.id).where(ListingLocal.listing_id == listing_id)).one_or_none()
        pers = (json.loads(local.data_json).get("personalization") or {}) if local else {}
        return PersonalizationOut(questions=pers.get("questions", []))
    row = _get_cache_row(db, shop, listing_id)
    if row is None or not row.extras_synced:
        row = _fetch_and_cache_one(db, shop, EtsyClient(db, shop), listing_id)
    return PersonalizationOut(questions=[_clean_question(q) for q in json.loads(row.personalization_json or "[]")])


def get_personalization_library(db: Session, shop: Shop) -> list[dict]:
    """Mağazanın diğer listing'lerinde kullanılan benzersiz özel seçenek alanları (Etsy'deki "Recently used").
    Yalnızca yerel önbellekten okunur; kullanım sayısına göre sıralanır."""
    found: dict[tuple, dict] = {}
    for row in db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id)).all():
        for raw in json.loads(row.personalization_json or "[]"):
            q = _clean_question(raw)
            q.question_id = None
            for o in q.options:
                o.option_id = None
            key = (q.question_text, q.question_type, q.instructions, q.required, tuple(o.label for o in q.options))
            entry = found.setdefault(key, {**q.model_dump(), "count": 0})
            entry["count"] += 1
    return sorted(found.values(), key=lambda e: (-e["count"], e["question_text"]))


def _question_payload(q: PersonalizationQuestion) -> dict:
    """updateListingPersonalization gövdesi: mevcut tüm sorular tam liste olarak gönderilir (Etsy hepsini değiştirir)."""
    body: dict = {"question_text": q.question_text, "question_type": q.question_type, "required": q.required}
    if q.instructions:
        body["instructions"] = q.instructions
    if q.question_type == "text_input" and q.max_allowed_characters:
        body["max_allowed_characters"] = q.max_allowed_characters
    if q.question_type in ("unlabeled_upload", "labeled_upload") and q.max_allowed_files:
        body["max_allowed_files"] = q.max_allowed_files
    if q.question_type in ("dropdown", "labeled_upload"):
        body["options"] = [{"label": o.label} for o in q.options if o.label.strip()]
    if q.add_on_price:
        body["add_on_price"] = q.add_on_price
    return body


def update_listing_personalization(
    db: Session, shop: Shop, listing_id: int, payload: PersonalizationIn
) -> PersonalizationOut:
    client = EtsyClient(db, shop)
    questions = [q for q in payload.questions if q.question_text.strip()]
    if not questions:
        etsy_personalization.delete_personalization(client, listing_id)
        result: list[dict] = []
    else:
        etsy_personalization.update_personalization(client, listing_id, [_question_payload(q) for q in questions])
        result = etsy_personalization.get_personalization(listing_id)
    row = _get_cache_row(db, shop, listing_id)
    if row is not None:
        row.personalization_json = json.dumps(result, ensure_ascii=False)
        db.commit()
    return PersonalizationOut(questions=[_clean_question(q) for q in result])


def get_variation_images(db: Session, shop: Shop, listing_id: int) -> list[dict]:
    if listing_id < 0:
        return []
    """Yerel önbellekten okur; yalnızca hiç senkronize edilmemiş eski satırlarda bir kez Etsy'ye gider."""
    row = _get_cache_row(db, shop, listing_id)
    if row is None or not row.extras_synced:
        row = _fetch_and_cache_one(db, shop, EtsyClient(db, shop), listing_id)
    return _unescape(json.loads(row.variation_images_json or "[]"))


def update_variation_images(db: Session, shop: Shop, listing_id: int, payload: VariationImagesIn) -> list[dict]:
    return etsy_variation_images.update_variation_images(
        EtsyClient(db, shop), listing_id, payload.variation_images
    )


def reorder_listing_images(db: Session, shop: Shop, listing_id: int, payload: ImageOrderIn) -> list[dict]:
    """Etsy'de sıralama endpoint'i yok: değişen kuyruğu silip aynı id'lerle sırayla geri bağlar."""
    client = EtsyClient(db, shop)
    current = [img["listing_image_id"] for img in etsy_images.list_images(client, listing_id)]
    wanted = payload.image_ids
    if sorted(current) != sorted(wanted):
        raise ValueError("Görsel listesi Etsy'dekiyle uyuşmuyor; sayfayı yenileyip tekrar dene.")

    start = next((i for i, (a, b) in enumerate(zip(current, wanted)) if a != b), None)
    if start is not None:
        tail = wanted[start:]
        for image_id in tail:
            etsy_images.delete_image(client, listing_id, image_id)
        for offset, image_id in enumerate(tail):
            try:
                etsy_images.reassign_image(client, listing_id, image_id, start + offset + 1)
            except Exception:
                # En iyi çaba: kalan görselleri geri bağla ki hiçbiri kaybolmasın.
                for rest_offset, rest_id in enumerate(tail[offset:], start=offset):
                    try:
                        etsy_images.reassign_image(client, listing_id, rest_id, start + rest_offset + 1)
                    except Exception:
                        pass
                raise

    fresh = etsy_images.list_images(client, listing_id)
    row = _get_cache_row(db, shop, listing_id)
    if row is not None:
        raw = json.loads(row.raw_json)
        raw["images"] = fresh
        row.raw_json = json.dumps(raw, ensure_ascii=False)
        db.commit()
    return fresh

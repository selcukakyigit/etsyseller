"""Etsy'ye giden değişikliklerin kaydı (ListingChange).

Yayın (drafts.publish_local) bittiğinde `record_publish` neyin değiştiğini, değişikliğin yapay zekâ önerisiyle mi elle mi
yapıldığını ve o anki teşhisin odağını yazar. Etsy'de doğrudan yapılan metin değişiklikleri günlük kayıtta parmak izi
değişince `detect_etsy_changes` ile eklenir. Ölçüm insights/impact.py'dedir."""
import datetime as dt
import html
import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.listings.models import ListingChange, ListingStatSnapshot, ListingVersion
from app.shops.models import Shop

_log = logging.getLogger(__name__)

# Yayın kararındaki (drafts._verdicts) temel alanların değişiklik türüne karşılığı; listede olmayanlar "other" sayılır.
_CORE_KIND = {
    "title": "title", "description": "description", "tags": "tags", "materials": "materials", "style": "tags",
    "taxonomy_id": "category", "shipping_profile_id": "shipping", "return_policy_id": "shipping",
}
_IGNORED_CORE = {"state", "featured_rank", "should_auto_renew", "shop_section_id"}  # satış performansını etkilemeyen ayarlar


def _min_price(inv: dict | None) -> float | None:
    prices = []
    for p in (inv or {}).get("products", []):
        for o in p.get("offerings", []):
            if not o.get("is_enabled", True):
                continue
            price = o.get("price")
            if isinstance(price, dict) and price.get("divisor"):
                prices.append(price["amount"] / price["divisor"])
            elif isinstance(price, (int, float)):
                prices.append(float(price))
    return round(min(prices), 2) if prices else None


def _variation_shape(inv: dict | None) -> list:
    return sorted(
        json.dumps(sorted((v["property_id"], list(v.get("values", []))) for v in p.get("property_values", [])))
        for p in (inv or {}).get("products", [])
    )


def _first_image(images: list | None) -> int | None:
    imgs = sorted(images or [], key=lambda i: i.get("rank", 0))
    return imgs[0].get("listing_image_id") if imgs else None


def describe(verdict: dict, base: dict, work: dict) -> tuple[list[str], dict]:
    """Yayın kararından değişen alanlar ve kısa özet. Yalnızca gönderilen (send/conflict ile zorlanan) alanlar sayılır."""
    fields: set[str] = set()
    details: dict = {}
    for k, x in verdict.get("core", {}).items():
        if x == "skip" or k in _IGNORED_CORE:
            continue
        fields.add(_CORE_KIND.get(k, "other"))
    if any(x != "skip" for x in verdict.get("props", {}).values()):
        fields.add("properties")
    if verdict.get("inventory") not in (None, "skip"):
        before_p, after_p = _min_price(base.get("inventory")), _min_price(work.get("inventory"))
        if before_p != after_p:
            fields.add("price")
            details["price_before"], details["price_after"] = before_p, after_p
        if _variation_shape(base.get("inventory")) != _variation_shape(work.get("inventory")):
            fields.add("inventory")
        if not {"price", "inventory"} & fields:
            fields.add("inventory")  # stok/SKU gibi küçük değişiklik
    if verdict.get("images") == "send" or verdict.get("links") not in (None, "skip"):
        fields.add("images")
        details["images_before"], details["images_after"] = len(base.get("images") or []), len(work.get("images") or [])
        if _first_image(base.get("images")) != _first_image(work.get("images")):
            details["thumbnail_changed"] = True
    if verdict.get("videos") == "send":
        fields.add("videos")
    if verdict.get("personalization") not in (None, "skip"):
        fields.add("personalization")

    if "title" in fields:
        details["title_before"] = html.unescape(base.get("title") or "")
        details["title_after"] = work.get("title") or ""
    if "tags" in fields:
        old, new = base.get("tags") or [], work.get("tags") or []
        lo_old, lo_new = {t.lower() for t in old}, {t.lower() for t in new}
        details["tags_added"] = [t for t in new if t.lower() not in lo_old]
        details["tags_removed"] = [t for t in old if t.lower() not in lo_new]
    return sorted(fields), details


def _ai_assisted(db: Session, shop: Shop, listing_id: int, since: dt.datetime | None) -> bool:
    """Son yayından bu yana bu listing için yapay zekâ önerisi üretilip geri alınmadıysa değişiklik AI destekli sayılır."""
    q = select(ListingVersion.id).where(
        ListingVersion.shop_id == shop.id, ListingVersion.listing_id == listing_id, ListingVersion.kind == "ai_suggestion",
        ListingVersion.status != "dismissed",
    )
    if since is not None:
        q = q.where(ListingVersion.created_at > since)
    else:
        q = q.where(ListingVersion.created_at > dt.datetime.utcnow() - dt.timedelta(days=30))
    return db.scalars(q.limit(1)).first() is not None


def last_change(db: Session, shop_id: int, listing_id: int) -> ListingChange | None:
    return db.scalars(
        select(ListingChange).where(ListingChange.shop_id == shop_id, ListingChange.listing_id == listing_id)
        .order_by(ListingChange.published_at.desc()).limit(1)
    ).first()


def record_publish(db: Session, shop: Shop, listing_id: int, verdict: dict, base: dict, work: dict) -> ListingChange | None:
    """Yayının kaydı. Performansı etkileyen bir değişiklik yoksa (yalnızca durum/sıralama ayarı) kayıt açılmaz."""
    fields, details = describe(verdict, base, work)
    if not fields:
        return None
    prev = last_change(db, shop.id, listing_id)
    focus = None
    try:
        from app.insights import diagnosis

        d = diagnosis.diagnose(db, shop, listing_id)
        focus = d["action"]["key"] if d else None
    except Exception:  # noqa: BLE001 — teşhis hesaplanamazsa kayıt yine açılır
        _log.warning("Yayın kaydı için teşhis hesaplanamadı (listing %s)", listing_id, exc_info=True)
    row = ListingChange(
        shop_id=shop.id, listing_id=listing_id, published_at=dt.datetime.utcnow(),
        source="ai" if _ai_assisted(db, shop, listing_id, prev.published_at if prev else None) else "manual",
        fields=json.dumps(fields), details=json.dumps(details, ensure_ascii=False), focus=focus,
    )
    db.add(row)
    return row


def detect_etsy_changes(db: Session, shop_id: int) -> int:
    """Günlük kayıtta başlık/etiket/açıklama parmak izi değişmiş ama o gün (±1) Ulagg'dan yayın yapılmamışsa, değişiklik
    Etsy'de yapılmıştır: `source="etsy"` kaydı eklenir ki o da ölçülsün. Yalnızca son 3 günün kayıtlarına bakar."""
    since = dt.datetime.utcnow() - dt.timedelta(days=3)
    snaps = db.scalars(
        select(ListingStatSnapshot).where(ListingStatSnapshot.shop_id == shop_id, ListingStatSnapshot.captured_at >= since - dt.timedelta(days=2))
        .order_by(ListingStatSnapshot.listing_id, ListingStatSnapshot.captured_at)
    ).all()
    by_listing: dict[int, list[ListingStatSnapshot]] = {}
    for s in snaps:
        by_listing.setdefault(s.listing_id, []).append(s)
    added = 0
    for lid, rows in by_listing.items():
        hashed = [s for s in rows if s.content_hash]
        for prev, cur in zip(hashed, hashed[1:]):
            if cur.content_hash == prev.content_hash or cur.captured_at < since:
                continue
            near = db.scalars(select(ListingChange.id).where(
                ListingChange.shop_id == shop_id, ListingChange.listing_id == lid,
                ListingChange.published_at >= prev.captured_at - dt.timedelta(days=1),
                ListingChange.published_at <= cur.captured_at + dt.timedelta(days=1),
            ).limit(1)).first()
            if near is None:
                db.add(ListingChange(
                    shop_id=shop_id, listing_id=lid, published_at=cur.captured_at, source="etsy",
                    fields=json.dumps(["text"]), details="{}",
                ))
                added += 1
    return added


def serialize(row: ListingChange) -> dict:
    return {
        "id": row.id,
        "published_at": row.published_at.isoformat(),
        "source": row.source,
        "fields": json.loads(row.fields or "[]"),
        "details": json.loads(row.details or "{}"),
        "focus": row.focus,
        "result": json.loads(row.result_json) if row.result_json else None,
    }

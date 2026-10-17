"""Bir listing'in içerik denetimi için veriyi toplar ve `ai.audit`'e verir. Teşhis, düzenleyicideki "Kontrol et" ve yayın kaydı (önce/sonra seviye) bunu kullanır.

Tek giriş `audit_work`: bir ÇALIŞMA KOPYASI (Etsy'deki hâl, taslak ya da formdaki henüz kaydedilmemiş değerler) denetlenir; böylece canlı listing, taslak ve yayın öncesi/sonrası aynı kurallarla ölçülür."""
import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import audit, quality
from app.listings import bulk, fields, inventory_edit
from app.listings.models import ListingCache
from app.shops.models import Shop
from app.taxonomy import service as taxonomy_service

log = logging.getLogger(__name__)


def missing_attributes(work: dict) -> list[dict]:
    """Boş kategori özellikleri (varyasyonla zaten karşılananlar sayılmaz). Kategori tanımı alınamazsa boş döner: denetim özellik bulgusu üretmez."""
    tid = work.get("taxonomy_id")
    if not tid:
        return []
    try:
        defs = taxonomy_service.cached_properties(int(tid))
    except Exception:  # noqa: BLE001 - kategori özellikleri okunamazsa yalnızca o bulgu atlanır
        log.warning("Kategori özellikleri alınamadı (taxonomy %s)", tid, exc_info=True)
        return []
    rows = fields.describe(defs, work)["ozellikler"]
    return [{"name": r["ad"], "required": r["zorunlu"]} for r in rows if not r["secili"] and not inventory_edit.covered_by_variation(work, r["ad"])]


def audit_work(db: Session, shop: Shop, listing_id: int, work: dict, personalizable: bool | None = None, others: list[dict] | None = None) -> dict:
    """`work`: düzenleyicinin çalışma kopyası biçimi (title, tags, description, materials, images, taxonomy_id, properties, inventory, personalization, state, listing_type).
    `others`: mağazanın diğer listing'leri (verilmezse okunur; birden çok denetimde bir kez okuyup geçirmek için)."""
    inventory = work.get("inventory") or {}
    if personalizable is None:
        personalizable = bool((work.get("personalization") or {}).get("questions"))
    listing = {**{k: work.get(k) for k in ("title", "tags", "description", "materials", "images", "taxonomy_id", "state", "listing_type")}, "is_personalizable": personalizable}
    if others is None:
        others = quality.shop_others(db, shop.id, exclude_id=listing_id if listing_id > 0 else None)
    return audit.audit(listing, variations=quality.variation_values(inventory), inventory=inventory, missing_attributes=missing_attributes(work), others=others)


def audit_listing(db: Session, shop: Shop, listing_id: int) -> dict | None:
    """Etsy'deki (yerel önbellekteki) hâl."""
    row = db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id, ListingCache.listing_id == listing_id)).one_or_none()
    if row is None:
        return None
    return audit_work(db, shop, listing_id, bulk.snapshot_cached(row), personalizable=bool(json.loads(row.raw_json).get("is_personalizable")))

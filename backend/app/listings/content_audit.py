"""Bir listing'in içerik denetimi için veriyi toplar (yerel önbellekten) ve `ai.audit`'e verir. Teşhis, listing sağlığı ve arayüz bunu kullanır."""
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


def audit_listing(db: Session, shop: Shop, listing_id: int) -> dict | None:
    row = db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id, ListingCache.listing_id == listing_id)).one_or_none()
    if row is None:
        return None
    raw = json.loads(row.raw_json)
    work = bulk.snapshot_cached(row)
    inventory = json.loads(row.inventory_json or "{}")
    return audit.audit(
        raw, variations=quality.variation_values(inventory), inventory=inventory, missing_attributes=missing_attributes(work),
        others=quality.shop_others(db, shop.id, exclude_id=listing_id),
    )

"""Planı veritabanıyla kurar: editördeki AI önerisi ve sohbet asistanı BU işlevi çağırır (iki ayrı uygulama yok)."""
from sqlalchemy.orm import Session

from app.ai import quality
from app.listing_plan import facts as facts_mod
from app.listing_plan import plan as plan_mod
from app.listing_plan import sources
from app.shops.models import Shop


def for_listing(
    db: Session, shop: Shop, listing: dict, *, key: str, variations: dict[str, list[str]] | None = None, product: str | None = None,
    extra_facts: str = "", model_tags: list[str] | None = None, current_title: str = "", keep_proven_lead: bool = False, exclude_id: int | None = None,
) -> plan_mod.Plan:
    """`listing`: başlık/etiket/açıklama/malzeme/kategori (Etsy'deki listing, taslak ya da asistanın yeni listing argümanları).
    `current_title`: kullanıcının seçtiği/yazdığı başlık; verilirse açılış odur. `keep_proven_lead`: var olan listing'in açılışı satış
    getirmişse (kendi satışı ya da bu listing'e sipariş getiren arama) korunur. `key`: farklılık için listing'e özgü sabit anahtar."""
    title = str(listing.get("title") or "")
    facts = facts_mod.from_listing(
        title, str(listing.get("description") or ""), list(listing.get("tags") or []), list(listing.get("materials") or []),
        variations or {}, bool(listing.get("is_personalizable") or listing.get("personalizable")), product=product, extra=extra_facts,
    )
    pool = sources.pool(db, shop, {**listing, "title": title or facts.product})
    if keep_proven_lead and not current_title:
        lead = facts_mod.lead_phrase(title)
        if any(p.get("tag") == lead and (p.get("units") or p.get("etsy_orders")) for p in pool):
            current_title = title
    others = quality.shop_others(db, shop.id, exclude_id=exclude_id)
    return plan_mod.build(pool, facts, key=key, others=others, model_tags=model_tags, shop=shop, current_title=current_title)

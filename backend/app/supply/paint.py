"""Boyacı: "m² fiyatına göre" dağıtım. Her ürünün boya türü, boyacının fiyat listesindeki bir m² kalemidir (ürün başına bir kez seçilir, sonraki
işlerde kendiliğinden gelir). Ürünün payı = adet × yüzey alanı × boyalı yüz sayısı × o kalemin m² fiyatı; toplam işin tutarına eşitlenmez
(tutar daha fazlasını kapsıyorsa kalan dağıtılmaz). Ürün ölçüleri ortak ürün tanımından gelir (`products`)."""
import datetime as dt

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.modkit import pricebook, products, units
from app.modkit.access import EntityAccess
from app.modkit.models import PriceItem
from app.supply.models import ProductPaint

MODE = "paint_rate"


def candidates(db: Session, entity_id: int) -> list[PriceItem]:
    """Boya türü olabilecek kalemler: bu boyacının arşivlenmemiş alan (m², cm²) birimli hizmet/malzeme kalemleri."""
    return [i for i in db.scalars(select(PriceItem).where(PriceItem.entity_id == entity_id, PriceItem.kind.in_(("service", "material")),
                                                         PriceItem.archived_at.is_(None)).order_by(PriceItem.position, PriceItem.id))
            if i.unit in units.UNITS and units.UNITS[i.unit].dimension == "area"]


def _key(t: dict) -> tuple[int, int, str]:
    return t["shop_id"], t["listing_id"], t.get("variant") or ""


def clean_item(db: Session, access: EntityAccess, item_id) -> int | None:
    """Hedefte seçilen boya kalemi: bu boyacının uygun bir kalemi olmalı (yoksa 422); boş = seçilmemiş."""
    if not item_id:
        return None
    if int(item_id) not in {i.id for i in candidates(db, access.entity.id)}:
        raise HTTPException(422, tr("Boya türü bu boyacının m² fiyatlı bir kalemi olmalı.", "The paint type must be an area-priced item of this painter's price list."))
    return int(item_id)


def remember(db: Session, access: EntityAccess, targets: list[dict]) -> None:
    """Seçilen boya türlerini ürüne kaydeder (sonraki işte kendiliğinden gelsin). Çağıran commit eder."""
    saved = {(p.shop_id, p.listing_id, p.variant): p for p in db.scalars(select(ProductPaint).where(ProductPaint.entity_id == access.entity.id))}
    for t in targets:
        if not t.get("item_id"):
            continue
        row = saved.get(_key(t))
        if row is None:
            db.add(ProductPaint(entity_id=access.entity.id, shop_id=t["shop_id"], listing_id=t["listing_id"], variant=t.get("variant") or "", price_item_id=t["item_id"]))
        else:
            row.price_item_id = t["item_id"]


def items_for(db: Session, access: EntityAccess, targets: list[dict]) -> list[PriceItem | None]:
    """Her hedefin boya kalemi: seçilmişse o, yoksa ürüne kaydedilen, yoksa (boyacının tek uygun kalemi varsa) o; hiçbiri yoksa None."""
    options = {i.id: i for i in candidates(db, access.entity.id)}
    saved = {(p.shop_id, p.listing_id, p.variant): p.price_item_id for p in db.scalars(select(ProductPaint).where(ProductPaint.entity_id == access.entity.id))}
    only = next(iter(options.values())) if len(options) == 1 else None
    out = []
    for t in targets:
        out.append(options.get(t.get("item_id")) or options.get(saved.get(_key(t))) or only)
    return out


def amounts(db: Session, access: EntityAccess, targets: list[dict], when: dt.datetime) -> tuple[list[float], list[PriceItem]]:
    """Hedeflerin payı (iş para biriminde) ve boya kalemleri; boya türü seçilmemiş ya da ürün ölçüsü eksik ürünler adıyla söylenir (tahmin edilmez)."""
    chosen = items_for(db, access, targets)
    lacking = [products.label(t.get("title") or "", t.get("variant") or "", t["listing_id"]) for t, i in zip(targets, chosen) if i is None]
    if lacking:
        names = ", ".join(lacking[:5]) + (f" (+{len(lacking) - 5})" if len(lacking) > 5 else "")
        raise HTTPException(422, tr(f"Şu ürünlerde boya türü seçilmedi (satırdaki 'Boya' kutusundan seç): {names}",
                                    f"Pick a paint type for these products (the 'Paint' box in the row): {names}"))
    areas = products.weights(db, access, targets, "paint_area")  # adet × yüzey × yüz sayısı, mm²
    prices = pricebook.prices_at(db, [i.id for i in chosen], when)
    return [round(units.convert(a / 1e6, "m2", i.unit) * (prices[i.id].price if i.id in prices else 0.0), 2) for a, i in zip(areas, chosen)], chosen

"""Fiyat listesi motoru: kalem + birim + tarihli fiyat sürümleri.

Fiyat değişikliği eski satırı güncellemez, yeni sürüm ekler. Bir işin tutarı, işin tarihinde geçerli olan sürümle
hesaplanır; böylece fiyat artışı geçmiş işlerin maliyetini sonradan bozmaz."""
import datetime as dt

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.modkit import activity, material_types, materials, stock, units
from app.modkit.access import EntityAccess
from app.modkit.models import PriceItem, PriceVersion

KINDS = ("service", "material", "fee", "minimum")
MAX_ITEMS = 500
MAX_PRICE = 1e10
MAX_AUTO_QTY = 1e6
UNSET = object()  # güncellemede "bu alana dokunma" (None = kuralı kaldır)
STOCK_FIELDS = ("material", "thickness_mm", "plate_width", "plate_height", "plate_kg", "roll_width", "film_um", "roll_length")  # yalnızca malzeme kalemleri
MAX_STOCK = 1e6


def clean_price(price: float) -> float:
    try:
        p = float(price)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "Geçersiz fiyat") from exc
    if not (0 <= p < MAX_PRICE):
        raise HTTPException(422, "Geçersiz fiyat")
    return round(p, 4)


def _check_unit(kind: str, unit: str) -> str:
    if kind not in KINDS:
        raise HTTPException(422, "Geçersiz kalem türü")
    if kind in ("fee", "minimum"):
        return "job"  # sabit ücret ve minimum iş başınadır
    if unit not in units.UNITS:
        raise HTTPException(422, "Geçersiz birim")
    return unit


def _clean_auto_qty(access: EntityAccess, kind: str, value: float | None) -> float | None:
    """Tüketim kuralı yalnızca hizmet/malzemede anlamlıdır (sabit ücret zaten her işe bir kez eklenir) ve işin
    bileşimini değiştirdiği için yalnızca çalışma alanı üyesi koyabilir."""
    if value is None or kind in ("fee", "minimum"):
        return None
    access.require_member()
    if not 0 < float(value) <= MAX_AUTO_QTY:
        raise HTTPException(422, "Geçersiz miktar")
    return round(float(value), 6)


def _clean_stock(db: Session, access: EntityAccess, kind: str, fields: dict) -> dict:
    """Malzeme alanlarını doğrular; yalnızca verilen alanlar döner (None = alanı boşalt). Malzeme dışı kalemde yok sayılır."""
    if kind != "material":
        return {}
    out = {}
    for key in STOCK_FIELDS:
        if key not in fields:
            continue
        value = fields[key]
        if key == "material":
            material_types.check_key(db, access.entity.workspace_id, value)
            out[key] = value or None
        elif value is None:
            out[key] = None
        elif 0 < float(value) <= MAX_STOCK:
            out[key] = round(float(value), 3)
        else:
            raise HTTPException(422, "Geçersiz değer")
    return out


_MISSING_LABELS = {"material": ("malzeme türü", "material type"), "thickness_mm": ("kalınlık", "thickness"), "plate": ("plaka eni ve boyu", "plate width and length")}


def _check_material(item: PriceItem, complete: bool) -> None:
    """Malzeme kaleminin tür grubuna uyumu: birim grupta anlamlı olmalı, grupta anlamsız alanlar boşaltılır (gizli değer kalmasın); `complete`
    ise maliyet ve ürün eşleşmesi için gerekenler (`materials.missing`) dolu olmalı. Türü bilinmeyen eski kalemde alanlara dokunulmaz."""
    group = materials.group_of(materials.spec_of(item)[0])
    if group is not None:
        if item.unit not in materials.units_for(group):
            raise HTTPException(422, tr("Bu malzeme türü için bu birim seçilemez.", "This unit cannot be used for this material type."))
        allowed = materials.fields_for(group, item.unit)
        for key in STOCK_FIELDS[1:]:
            if key not in allowed:
                setattr(item, key, None)
    if complete and (gaps := materials.missing(item)):
        tr_names, en_names = zip(*(_MISSING_LABELS[g] for g in gaps))
        raise HTTPException(422, tr("Eksik bilgi: " + ", ".join(tr_names) + ".", "Missing: " + ", ".join(en_names) + "."))


def find_material(db: Session, entity_id: int, kind: str, thickness: float) -> PriceItem | None:
    """Tedarikçinin fiyat listesindeki, malzeme türü ve kalınlığı (±0,05 mm) uyan malzeme kalemi: ürün tanımları tedarikçiden bağımsız
    olduğu için ürünün malzemesi fiyat kalemine bu eşleşmeyle bağlanır. Birden çok kalem uyarsa türü/kalınlığı alanlarla açıkça
    girilmiş olan, sonra en eskisi seçilir; arşivlenmiş kalem sayılmaz."""
    items = db.scalars(select(PriceItem).where(PriceItem.entity_id == entity_id, PriceItem.kind == "material", PriceItem.archived_at.is_(None)).order_by(PriceItem.id))
    match = [i for i in items if (spec := materials.spec_of(i))[0] == kind and spec[1] and abs(spec[1] - thickness) < 0.05]
    return min(match, key=lambda i: (i.material is None, i.id)) if match else None


def get_item(db: Session, access: EntityAccess, item_id: int) -> PriceItem:
    item = db.get(PriceItem, item_id)
    if item is None or item.entity_id != access.entity.id:
        raise HTTPException(404, "Kalem bulunamadı")
    return item


def latest_prices(db: Session, item_ids: list[int]) -> dict[int, PriceVersion]:
    """Her kalemin en güncel fiyat sürümü (geleceğe tarihlenmiş olanlar dahil değil)."""
    return prices_at(db, item_ids, dt.datetime.utcnow())


def prices_at(db: Session, item_ids: list[int], when: dt.datetime) -> dict[int, PriceVersion]:
    """`when` anında geçerli sürüm. O tarihten önce hiç fiyat yoksa (kalem işten sonra eklenmiş) ilk sürüm kullanılır."""
    if not item_ids:
        return {}
    out: dict[int, PriceVersion] = {}
    first: dict[int, PriceVersion] = {}
    for v in db.scalars(select(PriceVersion).where(PriceVersion.item_id.in_(item_ids)).order_by(PriceVersion.valid_from, PriceVersion.id)):
        first.setdefault(v.item_id, v)
        if v.valid_from <= when:
            out[v.item_id] = v
    for iid, v in first.items():
        out.setdefault(iid, v)
    return out


def list_items(db: Session, access: EntityAccess, include_archived: bool = False) -> list[dict]:
    stmt = select(PriceItem).where(PriceItem.entity_id == access.entity.id)
    if not include_archived:
        stmt = stmt.where(PriceItem.archived_at.is_(None))
    items = list(db.scalars(stmt.order_by(PriceItem.kind, PriceItem.position, PriceItem.id)))
    cur = latest_prices(db, [i.id for i in items])
    counts = dict(db.execute(
        select(PriceVersion.item_id, func.count()).where(PriceVersion.item_id.in_([i.id for i in items])).group_by(PriceVersion.item_id)
    ).all()) if items else {}
    snap = stock.snapshot(db, items, {i.id: v.price for i in items if (v := cur.get(i.id))}) if access.is_member else None
    return [serialize(i, cur.get(i.id), counts.get(i.id, 0), snap) for i in items]


def serialize(item: PriceItem, version: PriceVersion | None, versions: int = 0, snap: dict[int, dict] | None = None) -> dict:
    """`snap`: stok durumları (`stock.snapshot`); yalnızca çalışma alanı üyesine verilir — misafir (tedarikçi) stoğu görmez."""
    return {
        "id": item.id, "kind": item.kind, "name": item.name, "unit": item.unit, "spec": item.spec,
        "position": item.position, "archived": item.archived_at is not None, "auto_qty": item.auto_qty,
        **({"material": item.material, "thickness_mm": item.thickness_mm, "plate_width": item.plate_width, "plate_height": item.plate_height,
            "plate_kg": item.plate_kg, "roll_width": item.roll_width, "film_um": item.film_um, "roll_length": item.roll_length,
            "group": materials.group_of(materials.spec_of(item)[0]), "missing": materials.missing(item),
            "by_length": materials.per_metre(item) is not None, "derived": materials.stock_prices(item, version.price) if version else None} if item.kind == "material" else {}),
        **({"track_stock": item.track_stock, "min_stock": item.min_stock, "pack_size": item.pack_size, "entry_units": stock.entry_units(item), **(snap or {}).get(item.id, {})}
           if snap is not None and item.kind == "material" else {}),
        "price": version.price if version else None,
        "price_from": version.valid_from.isoformat() + "Z" if version else None,
        "price_source": version.source if version else None,
        "versions": versions,
    }


def create_item(db: Session, access: EntityAccess, kind: str, name: str, unit: str, spec: str, price: float, auto_qty: float | None = None,
                fields: dict | None = None) -> PriceItem:
    """`fields`: malzeme alanları (tür, kalınlık…). Stok takibi kalem eklenirken değil, kalem satırındaki anahtarla (`update_item`) açılır."""
    access.require("prices.edit")
    name = (name or "").strip()[:120]
    if not name:
        raise HTTPException(422, "Kalem adı boş olamaz")
    unit = _check_unit(kind, unit)
    if kind == "minimum" and db.scalar(select(PriceItem.id).where(
        PriceItem.entity_id == access.entity.id, PriceItem.kind == "minimum", PriceItem.archived_at.is_(None)
    )):
        raise HTTPException(409, "Zaten bir minimum ücret tanımlı; onun fiyatını değiştir.")
    n = db.scalar(select(func.count()).select_from(PriceItem).where(PriceItem.entity_id == access.entity.id)) or 0
    if n >= MAX_ITEMS:
        raise HTTPException(422, "Kalem sınırına ulaşıldı")
    item = PriceItem(entity_id=access.entity.id, kind=kind, name=name, unit=unit, spec=(spec or "").strip()[:200], position=n,
                     auto_qty=_clean_auto_qty(access, kind, auto_qty), **_clean_stock(db, access, kind, fields or {}))
    if kind == "material":
        _check_material(item, complete=True)
    db.add(item)
    db.flush()
    p = clean_price(price)
    db.add(PriceVersion(item_id=item.id, price=p, valid_from=dt.datetime.utcnow(), source="guest" if access.is_guest else "owner", created_by=access.user.id))
    activity.log(db, access.entity.id, access.user, "price_item_added", {"item": name, "kind": kind, "unit": unit, "price": p, "by_guest": access.is_guest})
    db.commit()
    return item


def update_item(db: Session, access: EntityAccess, item: PriceItem, name: str | None, spec: str | None, auto_qty=UNSET, fields: dict | None = None,
                unit: str | None = None, in_use: bool = False, tracking: dict | None = None) -> None:
    """Ad, açıklama, tüketim kuralı ve malzeme alanları değişir. Birim yalnızca hiçbir işte kullanılmamış kalemde değişir (kullanılmışsa
    eski fiyatlar ve miktarlar anlamsızlaşırdı — yeni kalem açılır); birim değişince tüketim kuralı (eski birimde) kalkar, fiyat
    yeni birimde yeniden girilir."""
    access.require("prices.edit")
    if name is not None:
        name = name.strip()[:120]
        if not name:
            raise HTTPException(422, "Kalem adı boş olamaz")
        item.name = name
    if unit is not None and unit != item.unit and item.kind not in ("fee", "minimum"):
        if in_use:
            raise HTTPException(409, "Bu kalem işlerde kullanılmış; birimi değişmez, yeni kalem aç.")
        item.unit = _check_unit(item.kind, unit)
        item.auto_qty = None
    if spec is not None:
        item.spec = spec.strip()[:200]
    if auto_qty is not UNSET:
        item.auto_qty = _clean_auto_qty(access, item.kind, auto_qty)
    changes = _clean_stock(db, access, item.kind, fields or {})
    for key, value in stock.clean_tracking(access, item.kind, tracking or {}).items():
        setattr(item, key, value)
    for key, value in changes.items():
        setattr(item, key, value)
    if item.kind == "material" and (changes or unit is not None):  # eski kalem yalnızca adı/fiyatı değişirken kurallara göre yeniden denetlenmez
        _check_material(item, complete=True)
    db.commit()


def set_price(db: Session, access: EntityAccess, item: PriceItem, price: float, valid_from: dt.date | None = None) -> PriceVersion | None:
    """Yeni fiyat sürümü. Geçmiş tarihli düzeltme yalnızca çalışma alanı üyesine açıktır; misafir değişikliği şimdiden geçerlidir.
    Fiyat aynıysa sürüm eklenmez (None)."""
    access.require("prices.edit")
    if item.archived_at is not None:
        raise HTTPException(409, "Arşivlenmiş kalemin fiyatı değiştirilemez")
    p = clean_price(price)
    when = dt.datetime.utcnow()
    if valid_from is not None:
        if not access.is_member:
            raise HTTPException(403, "Bu işlem için yetkin yok")
        when = dt.datetime.combine(valid_from, dt.time.min)
        if when > dt.datetime.utcnow() + dt.timedelta(days=366):
            raise HTTPException(422, "Geçersiz tarih")
    now_version = latest_prices(db, [item.id]).get(item.id)
    if valid_from is not None and now_version is not None and when < now_version.valid_from:
        # Güncel fiyat daha eski bir tarihten geçerli sayılıyor (güncel fiyatın kendisi düzeltiliyor): güncel sürümün başlangıcı öne
        # çekilir, fiyatı da gelen değer olur; arada kalan sürümler (eski/yanlış girilmiş fiyatlar) bu tarihten itibaren geçersizdir.
        old = now_version.price
        db.execute(delete(PriceVersion).where(PriceVersion.item_id == item.id, PriceVersion.valid_from >= when, PriceVersion.id != now_version.id))
        now_version.valid_from, now_version.price = when, p
        activity.log(db, access.entity.id, access.user, "price_changed", {
            "item": item.name, "unit": item.unit, "old": old, "new": p, "currency": access.entity.currency,
            "valid_from": when.date().isoformat(), "backdated": True, "by_guest": access.is_guest,
        })
        db.commit()
        return now_version
    current = prices_at(db, [item.id], when).get(item.id)
    if current is not None and abs(current.price - p) < 1e-9:
        return None  # o tarihte zaten bu fiyat geçerli
    old = current.price if current else None
    v = PriceVersion(item_id=item.id, price=p, valid_from=when, source="guest" if access.is_guest else "owner", created_by=access.user.id)
    db.add(v)
    activity.log(db, access.entity.id, access.user, "price_changed", {
        "item": item.name, "unit": item.unit, "old": old, "new": p, "currency": access.entity.currency,
        "valid_from": when.date().isoformat(), "backdated": valid_from is not None, "by_guest": access.is_guest,
    })
    db.commit()
    return v


def history(db: Session, access: EntityAccess, item: PriceItem) -> list[dict]:
    from app.auth.models import User

    rows = db.execute(
        select(PriceVersion, User.name, User.email).outerjoin(User, User.id == PriceVersion.created_by)
        .where(PriceVersion.item_id == item.id).order_by(PriceVersion.valid_from.desc(), PriceVersion.id.desc())
    ).all()
    return [
        {"id": v.id, "price": v.price, "valid_from": v.valid_from.isoformat() + "Z", "source": v.source, "by": name or email or ""}
        for v, name, email in rows
    ]


def set_archived(db: Session, access: EntityAccess, item: PriceItem, archived: bool) -> None:
    access.require_member()
    item.archived_at = dt.datetime.utcnow() if archived else None
    activity.log(db, access.entity.id, access.user, "price_item_archived" if archived else "price_item_restored", {"item": item.name})
    db.commit()


def delete_item(db: Session, access: EntityAccess, item: PriceItem, in_use: bool) -> None:
    """Hiçbir işte kullanılmamış kalem silinir; kullanılmışsa arşivlenmesi istenir (geçmiş işler bozulmasın)."""
    access.require_member()
    if in_use:
        raise HTTPException(409, "Bu kalem işlerde kullanılmış; silmek yerine arşivle.")
    activity.log(db, access.entity.id, access.user, "price_item_deleted", {"item": item.name})
    db.delete(item)
    db.commit()

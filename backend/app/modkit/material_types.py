"""Malzeme türü kataloğu: yerleşik türler (`materials.MATERIALS`) + kullanıcının kendi eklediği türler (`MaterialType`, çalışma alanı seviyesinde).
Yerleşikler değişmez ve silinmez; kullanıcı türü eklenir ya da silinir. Silinen türün kalemleri "Diğer"e taşınır, ürün parçalarının malzemesi boşalır.
Form, ürün malzemesi seçici ve asistan hep bu kataloğu kullanır (tek kaynak)."""
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.modkit import activity, materials, packs
from app.modkit.access import EntityAccess
from app.modkit.models import MaterialType, ModuleEntity, PriceItem, ProductMeasure

MAX_TYPES = 40
DENSITY_RANGE = (0.05, 25.0)  # g/cm³


def _entity_ids(workspace_id: int):
    return select(ModuleEntity.id).where(ModuleEntity.workspace_id == workspace_id)


def _usage(db: Session, workspace_id: int) -> dict[str, int]:
    """Kullanıcı türlerinin kaç kalemde ve ürün parçasında kullanıldığı."""
    used: dict[str, int] = {}
    for stmt in (
        select(PriceItem.material, func.count()).where(PriceItem.entity_id.in_(_entity_ids(workspace_id)), PriceItem.material.like(f"{materials.CUSTOM_PREFIX}%")).group_by(PriceItem.material),
        select(ProductMeasure.text, func.count()).where(ProductMeasure.workspace_id == workspace_id, ProductMeasure.key == "material", ProductMeasure.text.like(f"{materials.CUSTOM_PREFIX}%")).group_by(ProductMeasure.text),
    ):
        for key, n in db.execute(stmt):
            used[key] = used.get(key, 0) + n
    return used


def serialize(key: str, m: materials.Material, used: int = 0) -> dict:
    return {"key": key, "tr": m.tr, "en": m.en, "group": m.group, "builtin": m.builtin, "density": m.density, "used": used}


def catalog(db: Session, access: EntityAccess) -> dict:
    """Seçilebilir türler ve grup kuralları. Üye bütün kullanıcı türlerini görür; misafir (tedarikçi) yalnızca bu kayıttaki kalemlerin kullandıklarını."""
    wid = access.entity.workspace_id
    rows = list(db.scalars(select(MaterialType).where(MaterialType.workspace_id == wid).order_by(MaterialType.name)))
    used = _usage(db, wid)
    if not access.is_member:
        mine = set(db.scalars(select(PriceItem.material).where(PriceItem.entity_id == access.entity.id, PriceItem.material.is_not(None))))
        rows = [r for r in rows if materials.custom_key(r.id) in mine]
    custom = []
    for r in rows:
        key = materials.custom_key(r.id)
        m = materials.Material(r.name, r.name, r.group, (), r.density, builtin=False)
        materials.remember(key, m)
        custom.append(serialize(key, m, used.get(key, 0)))
    return {"types": [serialize(k, m) for k, m in materials.MATERIALS.items()] + custom, "groups": materials.catalog_rules(), "packs": packs.catalog()}


def check_key(db: Session, workspace_id: int, key: str | None, sheet_only: bool = False) -> None:
    """Anahtar bu çalışma alanında seçilebilir bir tür mü (yerleşik ya da bu çalışma alanının kendi türü)? Değilse 422."""
    if key in (None, ""):
        return
    m = materials.get(key) if key in materials.MATERIALS else None
    if m is None and key.startswith(materials.CUSTOM_PREFIX) and key[len(materials.CUSTOM_PREFIX):].isdigit():
        row = db.get(MaterialType, int(key[len(materials.CUSTOM_PREFIX):]))
        if row is not None and row.workspace_id == workspace_id:
            m = materials.get(key)
    if m is None or (sheet_only and not m.sheet):
        raise HTTPException(422, tr("Geçersiz malzeme türü", "Invalid material type"))


def _name_taken(db: Session, workspace_id: int, name: str) -> bool:
    low = name.casefold()
    if any(low in (m.tr.casefold(), m.en.casefold()) for m in materials.MATERIALS.values()):
        return True
    return db.scalar(select(MaterialType.id).where(MaterialType.workspace_id == workspace_id, func.lower(MaterialType.name) == low)) is not None


def create(db: Session, access: EntityAccess, name: str, group: str, density: float | None) -> dict:
    access.require_member()
    name = " ".join((name or "").split())[:60]
    if not name:
        raise HTTPException(422, tr("Bir ad yaz.", "Enter a name."))
    if group not in materials.GROUPS:
        raise HTTPException(422, tr("Geçersiz grup", "Invalid group"))
    if group == "sheet":
        if density is None or not DENSITY_RANGE[0] <= density <= DENSITY_RANGE[1]:
            raise HTTPException(422, tr("Levha türü için yoğunluk (g/cm³) gerekir, örn. çelik 7,85.", "A sheet type needs a density (g/cm³), e.g. steel 7.85."))
    else:
        density = None
    wid = access.entity.workspace_id
    if _name_taken(db, wid, name):
        raise HTTPException(409, tr("Bu adda bir malzeme türü zaten var.", "A material type with this name already exists."))
    if (db.scalar(select(func.count()).select_from(MaterialType).where(MaterialType.workspace_id == wid)) or 0) >= MAX_TYPES:
        raise HTTPException(422, tr("Malzeme türü sınırına ulaşıldı.", "Material type limit reached."))
    row = MaterialType(workspace_id=wid, name=name, group=group, density=round(density, 3) if density is not None else None)
    db.add(row)
    db.flush()
    key = materials.custom_key(row.id)
    materials.remember(key, materials.Material(row.name, row.name, row.group, (), row.density, builtin=False))
    activity.log(db, access.entity.id, access.user, "material_type_added", {"name": name, "group": group}, internal=True)
    db.commit()
    return serialize(key, materials.get(key))


def delete(db: Session, access: EntityAccess, key: str) -> dict:
    """Kullanıcı türünü siler: kalemleri "Diğer"e taşınır, ürün parçalarının malzemesi boşalır (ürünler yalnızca levha türüyle eşleşir). Taşınan sayı döner."""
    access.require_member()
    wid = access.entity.workspace_id
    row = db.get(MaterialType, int(key[len(materials.CUSTOM_PREFIX):])) if key.startswith(materials.CUSTOM_PREFIX) and key[len(materials.CUSTOM_PREFIX):].isdigit() else None
    if row is None or row.workspace_id != wid:
        raise HTTPException(404, tr("Malzeme türü bulunamadı", "Material type not found"))
    items = db.execute(update(PriceItem).where(PriceItem.entity_id.in_(_entity_ids(wid)), PriceItem.material == key).values(material=materials.FALLBACK)).rowcount
    parts = db.execute(update(ProductMeasure).where(ProductMeasure.workspace_id == wid, ProductMeasure.key == "material", ProductMeasure.text == key).values(text="")).rowcount
    activity.log(db, access.entity.id, access.user, "material_type_deleted", {"name": row.name, "items": items, "parts": parts}, internal=True)
    db.delete(row)
    db.commit()
    return {"items": items, "parts": parts}

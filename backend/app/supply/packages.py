"""Ambalaj: paket türleri (tarifler), ürüne atama ve maliyetin Finans'a yazılması.

Paket türü, bir tedarikçi kaydına (ambalaj satan) bağlı satır listesidir; her satır o tedarikçinin fiyat listesindeki bir kalemin miktarını
ürün ebadından hesaplar: miktar = sabit + a × uzun kenar + b × kısa kenar + c × alan (metre ve m²; sonuç kalemin biriminde), isteğe bağlı
uzun kenar aralığıyla (boyuta göre kutu seçimi). Ürünün ebadı ortak ürün tanımından gelir (en büyük parçanın sınır kutusu). Ürüne paket türü
atanır; atanmamışsa varsayılan paket türleri uygulanır, "ambalajsız" işaretliyse hiçbiri. Ambalaj maliyeti ürünün birim maliyetine, o tedarikçi
kaydının "ambalaj" bileşeni olarak (tarihli) yazılır. Yalnızca çalışma alanı üyesi kullanır."""
import datetime as dt

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.modkit import materials, pricebook, products, units
from app.modkit.access import EntityAccess
from app.modkit.models import ModuleEntity, PriceItem, ProductMeasure
from app.supply import fx
from app.supply.models import PackageLine, PackageType, ProductPackage

MODULE = "supply"
MAX_TYPES = 30
MAX_LINES = 30
MAX_COEFFICIENT = 1e6
LINE_KINDS = ("material", "service")  # malzeme ve işçilik kalemi; sabit ücret/minimum iş başınadır, ürün başına değil
Dims = tuple[float, float]  # (uzun kenar, kısa kenar), metre


# --------------------------------------------------------------- hesap ----

def dims_of(parts: list[dict]) -> Dims | None:
    """Ürünün ebadı: en büyük parçanın sınır kutusu (uzun, kısa; metre); ebat tanımlı değilse None."""
    sized = [p["values"] for p in parts if p["values"].get("width") and p["values"].get("height")]
    if not sized:
        return None
    v = max(sized, key=lambda x: x["width"] * x["height"])
    return max(v["width"], v["height"]) / 1000, min(v["width"], v["height"]) / 1000


def quantity(item: PriceItem, line: PackageLine, dims: Dims) -> tuple[float | None, str | None]:
    """Satırın miktarı, kalemin biriminde, ve eksik bilgi varsa hangisi ("plate" | "thickness"; o zaman miktar None). Formül metre ve m² verir:
    - rulo kalemi (streç kg, bant adet): metre olarak okunur (alan terimi rulo eni varsa ene bölünür), kg/adete rulo bilgisiyle çevrilir;
    - uzunluk kalemi (mm, cm, m): metreden; alan kalemi (cm², m²): m²'den;
    - hacim kalemi (ml, l, m³) ve kalınlığı olan kalem: alan × kalınlık; tabaka kalemi: alan / plaka alanı;
    - kütle kalemi (kg…) levha malzemede (kalınlık ve yoğunluk biliniyorsa): alan × kalınlık × yoğunluk;
    - diğerleri (adet, kg sarf…) olduğu gibi (genelde sabit)."""
    long_m, short_m = dims
    area = line.per_area * long_m * short_m
    raw = line.constant + line.per_long * long_m + line.per_short * short_m + area
    by_metre = materials.per_metre(item)
    if by_metre is not None:
        if item.roll_width:  # eni belli rulo: örtülecek alan, rulo eni kadar şeritle metreye çevrilir
            raw += area / (item.roll_width / 1000) - area
        return raw * by_metre, None
    unit = units.UNITS.get(item.unit)
    dimension = unit.dimension if unit else None
    if dimension == "length":
        return units.convert(raw, "m", item.unit), None
    if dimension == "area":
        return units.convert(raw, "m2", item.unit), None
    if dimension == "volume":
        return (units.convert(raw * item.thickness_mm / 1000, "m3", item.unit), None) if item.thickness_mm else (None, "thickness")
    if dimension == "sheet":
        plate = materials.plate_dims(item)
        return (raw / (plate[0] * plate[1] / 1e6), None) if plate else (None, "plate")
    if dimension == "mass":
        key, thickness = materials.spec_of(item)
        density = materials.MATERIALS[key].density if key in materials.MATERIALS else None
        if density and thickness:
            return units.convert(raw * thickness / 1000 * density * 1000, "kg", item.unit), None
    return raw, None


def evaluate(db: Session, lines: list[PackageLine], dims: Dims, when: dt.datetime) -> list[dict]:
    """Satırların miktarı ve maliyeti (fiyat listesindeki `when` tarihli fiyatla): [{item_id, name, unit, qty, missing (eksik kalem bilgisi), metres (rulo kalemlerinde), unit_price, cost}]."""
    items = {i.id: i for i in db.scalars(select(PriceItem).where(PriceItem.id.in_([ln.price_item_id for ln in lines])))} if lines else {}
    prices = pricebook.prices_at(db, list(items), when)
    out = []
    for ln in lines:
        item = items.get(ln.price_item_id)
        if item is None:
            continue
        qty, missing = quantity(item, ln, dims)
        price = prices[item.id].price if item.id in prices else 0.0
        by_metre = materials.per_metre(item)
        out.append({"item_id": item.id, "name": item.name, "unit": item.unit, "qty": round(qty or 0.0, 4), "missing": missing,
                    "metres": round(qty / by_metre, 3) if by_metre and qty is not None else None, "unit_price": price, "cost": round((qty or 0.0) * price, 2)})
    return out


# --------------------------------------------------------------- tarifler ----

def _line_row(ln: PackageLine, item: PriceItem | None) -> dict:
    return {"id": ln.id, "price_item_id": ln.price_item_id, "item_name": item.name if item else "", "unit": item.unit if item else "", "constant": ln.constant,
            "per_long": ln.per_long, "per_short": ln.per_short, "per_area": ln.per_area}


def _workspace_entities(db: Session, workspace_id: int) -> dict[int, str]:
    return dict(db.execute(select(ModuleEntity.id, ModuleEntity.name).where(ModuleEntity.workspace_id == workspace_id, ModuleEntity.module == MODULE)).all())


def list_types(db: Session, access: EntityAccess) -> list[dict]:
    """Çalışma alanındaki bütün paket türleri (her tedarikçi kaydının): ürüne atarken hepsi seçilebilir; `own` bu kayda ait olanlar."""
    access.require_member()
    entities = _workspace_entities(db, access.entity.workspace_id)
    types = list(db.scalars(select(PackageType).where(PackageType.entity_id.in_(list(entities))).order_by(PackageType.entity_id, PackageType.position, PackageType.id)))
    lines = list(db.scalars(select(PackageLine).where(PackageLine.package_id.in_([t.id for t in types])).order_by(PackageLine.position, PackageLine.id))) if types else []
    items = {i.id: i for i in db.scalars(select(PriceItem).where(PriceItem.id.in_([ln.price_item_id for ln in lines])))} if lines else {}
    return [{"id": t.id, "entity_id": t.entity_id, "entity_name": entities[t.entity_id], "own": t.entity_id == access.entity.id, "name": t.name, "is_default": t.is_default,
             "lines": [_line_row(ln, items.get(ln.price_item_id)) for ln in lines if ln.package_id == t.id]} for t in types]


def _clean_lines(db: Session, access: EntityAccess, raw: list[dict]) -> list[dict]:
    if not raw or len(raw) > MAX_LINES:
        raise HTTPException(422, tr("Paket türünde en az bir, en fazla 30 satır olmalı.", "A package type needs between 1 and 30 lines."))
    ids = {int(r["price_item_id"]) for r in raw}
    items = {i.id: i for i in db.scalars(select(PriceItem).where(PriceItem.id.in_(ids), PriceItem.entity_id == access.entity.id))}
    if len(items) != len(ids) or any(i.kind not in LINE_KINDS or i.archived_at is not None for i in items.values()):
        raise HTTPException(422, tr("Satırdaki malzeme bu tedarikçinin fiyat listesinde (malzeme ya da hizmet, arşivlenmemiş) olmalı.", "Each line's item must be an active material or service in this supplier's price list."))
    out = []
    for r in raw:
        coefs = {k: float(r.get(k) or 0.0) for k in ("constant", "per_long", "per_short", "per_area")}
        if any(not 0 <= v <= MAX_COEFFICIENT for v in coefs.values()) or not any(coefs.values()):
            raise HTTPException(422, tr("Her satırda en az bir katsayı (sabit, uzun, kısa kenar ya da alan) sıfırdan büyük olmalı.", "Each line needs at least one coefficient above zero."))
        out.append({"price_item_id": int(r["price_item_id"]), **coefs})
    return out


def save_type(db: Session, access: EntityAccess, package_id: int | None, name: str, is_default: bool, raw_lines: list[dict]) -> dict:
    access.require_member()
    name = (name or "").strip()[:80]
    if not name:
        raise HTTPException(422, tr("Paket türünün adı boş olamaz.", "The package type needs a name."))
    lines = _clean_lines(db, access, raw_lines)
    if package_id is None:
        count = db.scalars(select(PackageType.id).where(PackageType.entity_id == access.entity.id)).all()
        if len(count) >= MAX_TYPES:
            raise HTTPException(422, tr("Paket türü sınırına ulaşıldı.", "Package type limit reached."))
        package = PackageType(entity_id=access.entity.id, name=name, position=len(count))
        db.add(package)
        db.flush()
    else:
        package = _own(db, access, package_id)
        package.name = name
        db.execute(delete(PackageLine).where(PackageLine.package_id == package.id))
    package.is_default = is_default
    for pos, ln in enumerate(lines):
        db.add(PackageLine(package_id=package.id, position=pos, **ln))
    db.commit()
    return next(t for t in list_types(db, access) if t["id"] == package.id)


def _own(db: Session, access: EntityAccess, package_id: int) -> PackageType:
    package = db.get(PackageType, package_id)
    if package is None or package.entity_id != access.entity.id:
        raise HTTPException(404, tr("Paket türü bulunamadı.", "Package type not found."))
    return package


def delete_type(db: Session, access: EntityAccess, package_id: int) -> None:
    access.require_member()
    db.delete(_own(db, access, package_id))
    db.commit()


def preview(db: Session, access: EntityAccess, raw_lines: list[dict], long_cm: float, short_cm: float) -> dict:
    """Kaydedilmemiş tarifin örnek bir ebat (cm) için miktar ve maliyeti: düzenleme ekranındaki anlık önizleme."""
    access.require_member()
    lines = [PackageLine(position=i, **ln) for i, ln in enumerate(_clean_lines(db, access, raw_lines))]
    rows = evaluate(db, lines, (max(long_cm, short_cm) / 100, min(long_cm, short_cm) / 100), dt.datetime.utcnow())
    return {"lines": rows, "total": round(sum(r["cost"] for r in rows), 2)}


# --------------------------------------------------------------- ürüne atama ----

def _defined_products(db: Session, workspace_id: int) -> dict[tuple[int, int, str], list[dict]]:
    """Ürün tanımı olan ürünler ve parçaları."""
    targets = sorted(set(db.execute(select(ProductMeasure.shop_id, ProductMeasure.listing_id, ProductMeasure.variant).where(ProductMeasure.workspace_id == workspace_id)).all()))
    return products.parts_for(db, workspace_id, targets) if targets else {}


def _explicit(db: Session, workspace_id: int) -> dict[tuple[int, int, str], list[int | None]]:
    out: dict[tuple[int, int, str], list[int | None]] = {}
    for r in db.scalars(select(ProductPackage).where(ProductPackage.workspace_id == workspace_id)):
        out.setdefault((r.shop_id, r.listing_id, r.variant), []).append(r.package_id)
    return out


def _resolved(explicit: list[int | None] | None, defaults: list[int]) -> list[int]:
    """Üründe geçerli paket türleri: elle atanmışlar, "ambalajsız" işaretliyse hiçbiri, hiç atama yoksa varsayılanlar."""
    if explicit is None:
        return defaults
    return [pid for pid in explicit if pid is not None]


def list_assignments(db: Session, access: EntityAccess) -> list[dict]:
    """Tanımlı her ürün için: elle atanan paket türleri, "ambalajsız" mı, geçerli paket türleri ve ambalaj maliyeti (bütün tedarikçilerin türleri, güncel fiyatla)."""
    access.require_member()
    ws = access.entity.workspace_id
    parts_by = _defined_products(db, ws)
    explicit = _explicit(db, ws)
    types = list_types(db, access)
    defaults = [t["id"] for t in types if t["is_default"]]
    lines = {ln.id: ln for ln in db.scalars(select(PackageLine).where(PackageLine.package_id.in_([t["id"] for t in types])))} if types else {}
    by_type: dict[int, list[PackageLine]] = {}
    for ln in sorted(lines.values(), key=lambda x: (x.position, x.id)):
        by_type.setdefault(ln.package_id, []).append(ln)
    titles = products.listing_titles(db, {(k[0], k[1]) for k in parts_by})
    out = []
    for key, parts in parts_by.items():
        ids = _resolved(explicit.get(key), defaults)
        dims = dims_of(parts)
        cost = round(sum(r["cost"] for pid in ids for r in evaluate(db, by_type.get(pid, []), dims, dt.datetime.utcnow())), 2) if dims else None
        marks = explicit.get(key)
        out.append({"shop_id": key[0], "listing_id": key[1], "variant": key[2], "title": titles.get((key[0], key[1]), ""),
                    "package_ids": [] if marks is None else [p for p in marks if p is not None], "none": marks is not None and None in marks,
                    "resolved_ids": ids, "cost": cost})
    return sorted(out, key=lambda r: (r["title"].lower(), r["variant"]))


def assign(db: Session, access: EntityAccess, shop_id: int, listing_id: int, variant: str, package_ids: list[int], none: bool) -> None:
    """Ürünün paket türlerini ayarlar: `none` "ambalajsız", boş liste (ve none değil) varsayılana döner."""
    access.require_member()
    ws = access.entity.workspace_id
    if shop_id not in products.workspace_shops(db, ws):
        raise HTTPException(404, "Mağaza bulunamadı")
    valid = {t["id"] for t in list_types(db, access)}
    if any(pid not in valid for pid in package_ids):
        raise HTTPException(404, tr("Paket türü bulunamadı.", "Package type not found."))
    db.execute(delete(ProductPackage).where(ProductPackage.workspace_id == ws, ProductPackage.shop_id == shop_id, ProductPackage.listing_id == listing_id, ProductPackage.variant == variant))
    for pid in ([None] if none else dict.fromkeys(package_ids)):
        db.add(ProductPackage(workspace_id=ws, shop_id=shop_id, listing_id=listing_id, variant=variant, package_id=pid))
    db.commit()


# --------------------------------------------------------------- Finans'a uygulama ----

def apply_costs(db: Session, access: EntityAccess, dry_run: bool) -> dict:
    """Bu tedarikçi kaydının paket türlerinin her ürün için maliyetini hesaplar; `dry_run` değilse ürünün birim maliyetine bu kaydın "ambalaj"
    bileşeni olarak bugünden geçerli yazar (eski siparişler değişmez). Maliyet tedarikçinin para biriminde hesaplanır, mağazanın rapor para birimine
    bugünkü kurla çevrilip yazılır (kur alınamazsa hata). Önizleme: [{title, variant, currency, old, new, source_new}] (old/new rapor para biriminde,
    source_new tedarikçi para biriminde); yalnızca değişenler."""
    from app.finance import service as finance_service

    access.require_member()
    ws = access.entity.workspace_id
    shops = products.workspace_shops(db, ws)
    parts_by = _defined_products(db, ws)
    explicit = _explicit(db, ws)
    types = list_types(db, access)
    defaults = [t["id"] for t in types if t["is_default"]]
    own = {t["id"] for t in types if t["own"]}
    lines: dict[int, list[PackageLine]] = {}
    for ln in db.scalars(select(PackageLine).where(PackageLine.package_id.in_(own)).order_by(PackageLine.position, PackageLine.id)) if own else []:
        lines.setdefault(ln.package_id, []).append(ln)
    titles = products.listing_titles(db, {(k[0], k[1]) for k in parts_by})
    component = f"pack:{access.entity.id}"
    label = f"{tr('Ambalaj', 'Packaging')} · {access.entity.name}"
    ref = f"pack:{access.entity.id}:{dt.datetime.utcnow():%y%m%d%H%M%S}"
    current = {shop_id: finance_service.cost_components(db, shop) for shop_id, shop in shops.items()}
    rows = []
    for key, parts in parts_by.items():
        shop = shops.get(key[0])
        dims = dims_of(parts)
        if shop is None or dims is None:
            continue
        source_new = round(sum(r["cost"] for pid in _resolved(explicit.get(key), defaults) if pid in own for r in evaluate(db, lines.get(pid, []), dims, dt.datetime.utcnow())), 2)
        currency = finance_service.report_currency(db, shop)
        new = round(source_new * fx.rate(access.entity.currency, currency, dt.date.today()), 2)
        combos = {o["key"]: o["combos"] for o in products.listing_variants(db, shop.id, key[1])}.get(key[2]) or [key[2]] if key[2] else [""]
        old = next((c["amount"] for c in current[key[0]].get((key[1], combos[0]), []) if c["label"] == label), 0.0)
        if abs(new - old) < 0.005:
            continue
        rows.append({"shop_id": key[0], "listing_id": key[1], "variant": key[2], "title": titles.get((key[0], key[1]), ""), "currency": currency, "old": old, "new": new, "source_new": source_new})
        if not dry_run:
            for combo in combos:
                finance_service.record_unit_cost(db, shop, key[1], combo, new, dt.date.today(), ref, MODULE, component, label)
    if not dry_run:
        db.commit()
    return {"items": sorted(rows, key=lambda r: (r["title"].lower(), r["variant"])), "applied": 0 if dry_run else len(rows)}

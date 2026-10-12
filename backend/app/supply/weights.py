"""Maliyet paylaştırmasının ürün ölçülerinden ve tedarikçinin fiyat listesinden hesapladığı ağırlıklar ve tahminler (kesim uzunluğu, delme,
boyanan alan, lazer + malzeme tahmini). Dış Tedarik'e özeldir; ürün tanımlarının kendisi ortaktır (`modkit.products`)."""
import datetime as dt

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.modkit import materials, pricebook, products
from app.modkit.access import EntityAccess


# Paylaştırmada ağırlık olarak kullanılabilen ölçüler (ürünün adet × parça adedi dahil toplamı).
WEIGHT_MODES = {
    "cut_length": ("kesim uzunluğu", "cut length"),
    "pierce_count": ("delme sayısı", "pierce count"),
    "paint_area": ("boyanan alan (yüzey alanı)", "painted area (surface)"),
}


def weight(values: dict[str, float], mode: str) -> float | None:
    """Bir ürünün bu paylaştırma türündeki birim ağırlığı; ölçü eksikse None."""
    return values.get(mode)


def weights(db: Session, access: EntityAccess, targets: list[dict], mode: str) -> list[float]:
    """Hedeflerin (adet × birim ölçü) ağırlıkları. Ölçüsü girilmemiş ürün varsa hangileri olduğu söylenir (tahmin edilmez)."""
    if mode not in WEIGHT_MODES:
        raise HTTPException(422, "Geçersiz paylaştırma")
    if any(t["listing_id"] is None for t in targets):
        raise HTTPException(422, tr("Ölçüye göre bölüştürmede genel gider seçilemez.", "Overhead cannot be used when splitting by a measure."))
    keys = [(t["shop_id"], t["listing_id"], t.get("variant") or "") for t in targets]
    vals = products.values_for(db, access.entity.workspace_id, keys)
    out, missing = [], []
    for t, key in zip(targets, keys):
        w = weight(vals.get(key, {}), mode)
        if w is None:
            missing.append(products.label(t.get("title") or "", key[2], t["listing_id"]))
        else:
            out.append(w * t["qty"])
    if missing:
        label_tr, label_en = WEIGHT_MODES[mode]
        names = ", ".join(missing[:5]) + (f" (+{len(missing) - 5})" if len(missing) > 5 else "")
        raise HTTPException(422, tr(f"Şu ürünlerde {label_tr} bilgisi yok (Ürünler sekmesinden gir): {names}",
                                    f"These products have no {label_en} (add it in the Products tab): {names}"))
    return out


def _supplier_item(db: Session, access: EntityAccess, part: dict, cache: dict):
    """Parçanın malzeme türü + kalınlığına uyan, bu tedarikçinin fiyat listesindeki malzeme kalemi; yoksa None."""
    kind, thickness = part["material"], part["values"].get("thickness")
    if not kind or not thickness:
        return None
    if (kind, thickness) not in cache:
        cache[(kind, thickness)] = pricebook.find_material(db, access.entity.id, kind, thickness)
    return cache[(kind, thickness)]


def _part_cost(part: dict, item, prices: dict) -> float | None:
    """Bir parçanın malzeme maliyeti (ürün başına, parça adedi dahil; ebadı ve malzeme kaleminden); hesaplanamazsa None."""
    v = part["values"]
    if item is None or item.id not in prices or not (v.get("width") and v.get("height")):
        return None
    cost = materials.stock_cost(item, prices[item.id].price, v["width"], v["height"])
    return None if cost is None else cost * products.part_qty(part)


def material_usage(db: Session, access: EntityAccess, targets: list[dict], when: dt.datetime) -> list[dict | None]:
    """Hedeflerin (adet dahil) kullandığı malzeme: {"parts": [{name, type, thickness, qty, kg, cost}], "kg", "cost"}; ürünün malzemesi
    tanımlı değilse None. Maliyet, tedarikçinin fiyat listesindeki eşleşen kalemden gelir (yoksa None). Bilgi amaçlıdır: toplamlar
    yalnızca bilinenleri sayar."""
    keys = [(t["shop_id"], t["listing_id"], t.get("variant") or "") for t in targets if t["listing_id"] is not None]
    parts = products.parts_for(db, access.entity.workspace_id, keys)
    cache: dict = {}
    items = {id(p): _supplier_item(db, access, p, cache) for ps in parts.values() for p in ps}
    prices = pricebook.prices_at(db, [i.id for i in items.values() if i is not None], when)
    out: list[dict | None] = []
    for t in targets:
        rows = []
        for p in parts.get((t["shop_id"], t["listing_id"], t.get("variant") or ""), []):
            kind, thickness = p["material"], p["values"].get("thickness")
            if not kind:
                continue
            item, v = items[id(p)], p["values"]
            sized = bool(v.get("width") and v.get("height"))
            kg = materials.stock_kg(item, kind, thickness, v["width"], v["height"]) if sized else None
            rows.append({"name": item.name if item else kind, "type": kind, "thickness": thickness, "qty": products.part_qty(p),
                         "kg": None if kg is None else kg * products.part_qty(p), "cost": _part_cost(p, item, prices)})
        known = lambda field: sum(r[field] for r in rows if r[field] is not None) * t["qty"]  # noqa: E731
        out.append({"parts": rows, "kg": known("kg"), "cost": known("cost")} if rows else None)
    return out


def estimates(db: Session, access: EntityAccess, targets: list[dict], laser_total: float, with_material: bool, when: dt.datetime,
              plate_cut: float | None = None) -> tuple[list[dict], float]:
    """Hedeflerin (adet dahil) tahmini maliyeti: ([{"laser", "material"}], plakanın seçilmeyen kısmının lazer bedeli).
    Lazer payı = süre bedeli × ürünün kesim uzunluğu payı; pay, plakanın toplam kesim uzunluğuna (`plate_cut`, rapordan) göre
    hesaplanır: plakada seçilmeyen parçalar (başka mağaza ya da iş) varsa onların bedeli ürünlere yüklenmez, ikinci değer olarak
    döner. Malzeme = ürünün ebadı ve tedarikçinin fiyat listesindeki malzeme kalemi (ürünün malzeme türü + kalınlığıyla eşleşen,
    `when` tarihindeki fiyatla). Gerçek tutar bu tahminlerin oranında paylaştırılır. Malzeme hesaplanamayan ürün varsa hangileri
    olduğu söylenir (tahmin edilmez)."""
    cuts = weights(db, access, targets, "cut_length")
    cut_total = max(plate_cut or 0.0, sum(cuts)) or 1.0
    laser = [laser_total * c / cut_total for c in cuts]
    rest = laser_total * (1 - sum(cuts) / cut_total)
    if not with_material:
        return [{"laser": x, "material": 0.0} for x in laser], rest
    keys = [(t["shop_id"], t["listing_id"], t.get("variant") or "") for t in targets]
    parts = products.parts_for(db, access.entity.workspace_id, keys)
    cache: dict = {}
    items = {id(p): _supplier_item(db, access, p, cache) for ps in parts.values() for p in ps}
    prices = pricebook.prices_at(db, [i.id for i in items.values() if i is not None], when)
    out, missing = [], []
    for t, key, fee in zip(targets, keys, laser):
        costs = [_part_cost(p, items[id(p)], prices) for p in parts.get(key, [])]
        if not costs or None in costs:
            missing.append(products.label(t.get("title") or "", key[2], t["listing_id"]))
        else:
            out.append({"laser": fee, "material": sum(costs) * t["qty"]})
    if missing:
        names = ", ".join(missing[:5]) + (f" (+{len(missing) - 5})" if len(missing) > 5 else "")
        raise HTTPException(422, tr(f"Malzeme maliyeti hesaplanamadı (ürünün malzeme türü, kalınlığı ya da ebadı eksik, ya da bu tedarikçinin fiyat listesinde karşılığı yok; Ürünler sekmesinden tamamla, fiyat listesine ekle ya da işte 'Malzeme kesimciden'i kapat): {names}",
                                    f"Material cost could not be worked out (the product's material type, thickness or size is missing, or this supplier's price list has no match; complete it in the Products tab, add it to the price list or turn off 'Material from the cutter' on the job): {names}"))
    return out, rest

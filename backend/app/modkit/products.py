"""Modüllerin mağaza ürünleriyle (listing) ilgili ortak işleri: çalışma alanının mağazaları, ürün arama ve ürün TANIMLARI
(kesim uzunluğu, delme sayısı, ebat, yüzey alanı, boyalı yüz sayısı, malzeme türü ve kalınlığı). Tanımlar elle girilir ya da çizim
dosyasından (DXF) otomatik doldurulur; çalışma alanı seviyesindedir: bir ürün bir kez tanımlanır, bütün tedarikçi kayıtları kullanır.
Maliyet paylaştırması bu ölçülere göre yapılır (bkz. `supply.weights`); tedarikçiye özel olan yalnızca fiyattır: ürünün
malzeme türü + kalınlığı, tedarikçinin fiyat listesindeki malzeme kalemiyle eşleşir (`pricebook.find_material`).

Ürün kimliği (mağaza, listing, seçenek): seçenek listing'in Etsy envanterindeki ebat/varyasyondur ("" = tüm ürün). Ölçüler,
paylaştırma hedefleri ve Finans'a yazılan maliyet aynı kimliği kullanır.

Yalnızca çalışma alanı üyesi kullanır; misafir (tedarikçi) mağaza ve ürün bilgisine hiç erişemez."""
import html
import json

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.listings.models import ListingCache
from app.drawings import cad
from app.modkit import materials, pricebook
from app.modkit.access import EntityAccess
from app.modkit.models import ProductMeasure
from app.shops.models import Shop

MAX_PRODUCTS_PER_WORKSPACE = 5000
LISTING_PAGE = 40  # açılır listede bir seferde gösterilen ürün sayısı (yazdıkça daralır)
MAX_VALUE = 1e9
MAX_PARTS = 20  # bir ürünün en fazla parça sayısı

# Saklanan ölçüler ve birimleri (mm uzunluk, mm2 alan, piece adet). Yeni bir modül kendi ölçüsünü buraya ekler.
# Ölçüler TEK parça içindir; ürün toplamı `part_qty` (ürünün bu parçasından kaç tane gerektiği, boşsa 1) ile çarpılarak bulunur.
# `surface`: net yüzey alanı (DXF'ten), `sides`: boyanan/basılan yüz sayısı (1 ya da 2, boşsa 1), `thickness`: malzeme kalınlığı.
MEASURES = {"cut_length": "mm", "pierce_count": "piece", "width": "mm", "height": "mm", "surface": "mm2", "sides": "piece", "thickness": "mm", "part_qty": "piece"}
# Malzeme türü sayı değil metindir (`ProductMeasure.text`, `materials.MATERIALS` anahtarı).
MATERIAL = "material"


def workspace_shops(db: Session, workspace_id: int) -> dict[int, Shop]:
    return {s.id: s for s in db.scalars(select(Shop).where(Shop.workspace_id == workspace_id))}


def clean_title(raw: str | None) -> str:
    """Etsy başlıkları HTML kodlu gelir (`32X22&quot;`); ekranda ve kayıtlarda çözülmüş hâliyle tutulur."""
    return html.unescape(raw or "")[:200]


def listing_image_of(data: dict) -> str:
    """Listing'in ilk fotoğrafı (küçük boy, Etsy CDN adresi); yoksa boş."""
    images = data.get("images") or []
    return (images[0].get("url_170x135") if images else "") or ""


def listing_price_of(data: dict) -> float:
    p = data.get("price") or {}
    try:
        return float(p.get("amount") or 0) / float(p.get("divisor") or 100)
    except (ValueError, TypeError):
        return 0.0


def listing_price(raw_json: str) -> float:
    try:
        return listing_price_of(json.loads(raw_json) or {})
    except json.JSONDecodeError:
        return 0.0


def shop_options(db: Session, access: EntityAccess) -> list[dict]:
    access.require_member()
    return [{"id": s.id, "name": s.shop_name or f"#{s.id}"} for s in workspace_shops(db, access.entity.workspace_id).values()]


def _shop_listings(db: Session, shop_id: int, q: str) -> list[tuple[int, str, dict]]:
    """Mağazanın yerel önbellekteki ilanları (ad ya da listing no ile süzülmüş): (listing no, başlık, ham veri)."""
    stmt = select(ListingCache.listing_id, ListingCache.title, ListingCache.raw_json).where(ListingCache.shop_id == shop_id)
    needle = q.strip()[:80]
    if needle.isdigit():
        stmt = stmt.where((ListingCache.listing_id == int(needle)) | ListingCache.title.ilike(f"%{needle}%"))
    elif needle:
        stmt = stmt.where(ListingCache.title.ilike(f"%{needle}%"))
    out = []
    for lid, title, raw in db.execute(stmt):
        try:
            data = json.loads(raw) or {}
        except json.JSONDecodeError:
            data = {}
        out.append((lid, clean_title(title), data))
    return out


def _used_listings(db: Session, access: EntityAccess, shop_id: int) -> set[int]:
    """Çalışma alanında tanımı daha önce girilmiş ürünler."""
    return set(db.scalars(select(ProductMeasure.listing_id).where(ProductMeasure.workspace_id == access.entity.workspace_id, ProductMeasure.shop_id == shop_id)))


def listing_sections(db: Session, access: EntityAccess, shop_id: int) -> list[dict]:
    """Mağaza bölümleri ve içlerindeki ürün sayısı: [{"id", "title", "count", "used"}]. `id` 0 = bölümü olmayanlar (başlığı boş,
    ekran adlandırır). `used`: bölümde tanımı girilmiş ürün sayısı. Bölüm adları yerel önbellekten okunur; Etsy'ye
    istek atılmaz. Seçici önce bölümleri gösterir, ürünler bölüm açılınca gelir (liste kalabalık olmasın)."""
    access.require_member()
    if shop_id not in workspace_shops(db, access.entity.workspace_id):
        raise HTTPException(404, "Mağaza bulunamadı")
    from app.shops import reference_cache  # döngüsel içe aktarmayı önlemek için burada

    names = {int(x["shop_section_id"]): clean_title(x.get("title")) for x in reference_cache.peek(db, shop_id, "sections") or [] if x.get("shop_section_id")}
    used = _used_listings(db, access, shop_id)
    counts: dict[int, list[int]] = {}
    for lid, _title, data in _shop_listings(db, shop_id, ""):
        sid = int(data.get("shop_section_id") or 0)
        c = counts.setdefault(sid, [0, 0])
        c[0] += 1
        c[1] += lid in used
    named = sorted(({"id": sid, "title": names.get(sid) or f"#{sid}", "count": c[0], "used": c[1]} for sid, c in counts.items() if sid), key=lambda x: x["title"].lower())
    return named + ([{"id": 0, "title": "", "count": counts[0][0], "used": counts[0][1]}] if 0 in counts else [])


def listing_options(db: Session, access: EntityAccess, shop_id: int, q: str, section: int | None = None, offset: int = 0) -> dict:
    """Mağaza ürünleri, sayfa sayfa: {"items", "more"}. `section`: yalnızca o bölümün ürünleri (0 = bölümsüz; None = hepsi).
    Tanımı girilmiş ürünler ("kayıtlı") başta, sonra başlığa göre. Seçenek (ebat) sayısı yalnızca gösterilen sayfa için
    hesaplanır."""
    access.require_member()
    if shop_id not in workspace_shops(db, access.entity.workspace_id):
        raise HTTPException(404, "Mağaza bulunamadı")
    rows = _shop_listings(db, shop_id, q)
    if section is not None:
        rows = [r for r in rows if int(r[2].get("shop_section_id") or 0) == section]
    used = _used_listings(db, access, shop_id)
    rows.sort(key=lambda r: (r[0] not in used, r[1].lower()))
    page = rows[offset: offset + LISTING_PAGE + 1]
    more = len(page) > LISTING_PAGE
    page = page[:LISTING_PAGE]
    inventories = {lid: inv for lid, inv in db.execute(select(ListingCache.listing_id, ListingCache.inventory_json).where(
        ListingCache.shop_id == shop_id, ListingCache.listing_id.in_([r[0] for r in page])))} if page else {}
    items = [{"listing_id": lid, "title": title, "price": listing_price_of(data), "image": listing_image_of(data),
              "variants": len(variants_of(inventories.get(lid))), "used": lid in used} for lid, title, data in page]
    return {"items": items, "more": more}


# --------------------------------------------------------------- seçenekler (varyasyonlar) ----

# Listing'in "ebat" özelliği: kesim ölçüsü renge değil ebada bağlıdır; özellik adı bunlardan birini içeriyorsa seçenek yalnızca o
# özelliğin değeridir (renkler tek ebatta toplanır). Yoksa seçenek tüm kombinasyondur.
_SIZE_WORDS = ("size", "boyut", "ebat", "beden", "olcu", "ölçü")
MAX_VARIANT = 300


def listing_variants(db: Session, shop_id: int, listing_id: int) -> list[dict]:
    return variants_of(db.scalar(select(ListingCache.inventory_json).where(ListingCache.shop_id == shop_id, ListingCache.listing_id == listing_id)))


def variants_of(raw_inventory: str | None) -> list[dict]:
    """Listing'in Etsy envanterindeki (`inventory_json`) seçenekler, satılmamış olanlar dahil: [{"key", "combos"}]. `key` seçenek
    adıdır ("SIZE: M-45"x13""), `combos` o seçeneğe giren tam kombinasyonlar ("Color: Black | SIZE: M-45"x13""): Finans'ın seçenek
    anahtarıyla birebir aynı biçim, böylece maliyet satıştaki seçeneğe yazılır. Envanter yoksa boş liste."""
    from app.finance.service import variant_key_from_pairs  # finans paketi ağırdır; yalnızca burada gerekir

    try:
        inventory = json.loads(raw_inventory or "{}")
    except json.JSONDecodeError:
        return []
    rows: list[list[tuple[str, str]]] = []
    for prod in inventory.get("products") or []:
        if prod.get("is_deleted"):
            continue
        pairs = [((pv.get("property_name") or "").strip(), str((pv.get("values") or [""])[0])) for pv in prod.get("property_values") or []]
        pairs = [(n, v) for n, v in pairs if n and n.lower() != "personalization"]
        if pairs:
            rows.append(pairs)
    if not rows:
        return []
    size_name = next((n for n, _ in rows[0] if any(w in n.lower() for w in _SIZE_WORDS)), None)
    options: dict[str, list[str]] = {}
    for pairs in rows:
        combo = variant_key_from_pairs(pairs)
        if size_name:
            value = next((v for n, v in pairs if n == size_name), None)
            if value is None:
                continue
            key = variant_key_from_pairs([(size_name, value)])
        else:
            key = combo
        options.setdefault(key, []).append(combo)
    return [{"key": k, "combos": c} for k, c in options.items()]


def check_variant(db: Session, shop_id: int, listing_id: int, variant: str) -> str:
    """Boş = tüm ürün; doluysa listing'in seçeneklerinden biri olmalı."""
    variant = (variant or "").strip()
    if not variant:
        return ""
    if len(variant) > MAX_VARIANT or variant not in {v["key"] for v in listing_variants(db, shop_id, listing_id)}:
        raise HTTPException(422, "Geçersiz seçenek")
    return variant


def variant_options(db: Session, access: EntityAccess, shop_id: int, listing_id: int) -> list[dict]:
    access.require_member()
    _check_shop(db, access, shop_id)
    _listing_title(db, shop_id, listing_id)
    return [{"key": v["key"]} for v in listing_variants(db, shop_id, listing_id)]


# --------------------------------------------------------------- ürün tanımları ----

def _listing_title(db: Session, shop_id: int, listing_id: int) -> str:
    row = db.execute(select(ListingCache.title).where(ListingCache.shop_id == shop_id, ListingCache.listing_id == listing_id)).first()
    if row is None:
        raise HTTPException(404, "Ürün bulunamadı")
    return clean_title(row[0])


def _check_shop(db: Session, access: EntityAccess, shop_id: int) -> None:
    if shop_id not in workspace_shops(db, access.entity.workspace_id):
        raise HTTPException(404, "Mağaza bulunamadı")


def _serialize(rows: list[ProductMeasure], titles: dict[tuple[int, int], str], shops: dict[int, Shop]) -> list[dict]:
    """Ürün parçası (listing + seçenek + parça) başına bir satır: sayısal ölçüler `values`'ta, malzeme türü `material`'da (anahtar ya da
    None). Tek parçalı ürün tek satırdır."""
    grouped: dict[tuple[int, int, str, int], dict] = {}
    for r in rows:
        g = grouped.setdefault((r.shop_id, r.listing_id, r.variant, r.part), {
            "shop_id": r.shop_id, "shop_name": shops[r.shop_id].shop_name if r.shop_id in shops else "", "listing_id": r.listing_id,
            "variant": r.variant, "part": r.part, "title": titles.get((r.shop_id, r.listing_id), ""), "values": {}, "material": None, "source": r.source,
            "updated_at": r.updated_at,
        })
        if r.key == MATERIAL:
            g["material"] = r.text or None
        else:
            g["values"][r.key] = r.value
        g["updated_at"] = max(g["updated_at"], r.updated_at)
    return [{**g, "updated_at": g["updated_at"].isoformat() + "Z"} for g in sorted(grouped.values(), key=lambda g: (g["title"].lower(), g["variant"], g["part"]))]


def listing_titles(db: Session, keys: set[tuple[int, int]]) -> dict[tuple[int, int], str]:
    if not keys:
        return {}
    shop_ids = {k[0] for k in keys}
    rows = db.execute(select(ListingCache.shop_id, ListingCache.listing_id, ListingCache.title).where(
        ListingCache.shop_id.in_(list(shop_ids)), ListingCache.listing_id.in_(list({k[1] for k in keys})))).all()
    return {(s, lid): clean_title(title) for s, lid, title in rows if (s, lid) in keys}


def list_measures(db: Session, access: EntityAccess) -> list[dict]:
    access.require_member()
    rows = list(db.scalars(select(ProductMeasure).where(ProductMeasure.workspace_id == access.entity.workspace_id)))
    return _serialize(rows, listing_titles(db, {(r.shop_id, r.listing_id) for r in rows}), workspace_shops(db, access.entity.workspace_id))


def _target(access: EntityAccess, shop_id: int, listing_id: int, variant: str, part: int | None = None):
    """Çalışma alanındaki bir ürüne (listing + seçenek; verilirse yalnızca bir parçası) ait satırların süzgeci."""
    cond = (ProductMeasure.workspace_id == access.entity.workspace_id, ProductMeasure.shop_id == shop_id, ProductMeasure.listing_id == listing_id, ProductMeasure.variant == variant)
    return cond if part is None else (*cond, ProductMeasure.part == part)


def _one(db: Session, access: EntityAccess, shop_id: int, listing_id: int, variant: str, part: int) -> dict:
    rows = list(db.scalars(select(ProductMeasure).where(*_target(access, shop_id, listing_id, variant, part))))
    out = _serialize(rows, listing_titles(db, {(shop_id, listing_id)}), workspace_shops(db, access.entity.workspace_id))
    return out[0] if out else {"shop_id": shop_id, "listing_id": listing_id, "variant": variant, "part": part, "title": _listing_title(db, shop_id, listing_id),
                               "values": {}, "material": None, "source": "manual"}


def _check_value(key: str, value: float) -> float:
    if not 0 < float(value) <= MAX_VALUE:
        raise HTTPException(422, "Geçersiz ölçü değeri")
    if key == "sides" and float(value) not in (1.0, 2.0):
        raise HTTPException(422, "Boyalı yüz sayısı 1 ya da 2 olmalı")
    return round(float(value), 4)


def _write(db: Session, access: EntityAccess, shop_id: int, listing_id: int, variant: str, part: int, values: dict[str, float | None],
           material, source: str) -> None:
    """Ürünün bir parçasının verilen ölçülerini ve (verilmişse) malzeme türünü yazar; değeri boş (None) olan silinir. `material`:
    `pricebook.UNSET` = dokunma, None = kaldır, aksi hâlde tür anahtarı. Çağıran commit eder."""
    if not 0 <= part < MAX_PARTS:
        raise HTTPException(422, "Geçersiz parça")
    existing = {r.key: r for r in db.scalars(select(ProductMeasure).where(*_target(access, shop_id, listing_id, variant, part)))}
    if not existing:
        distinct = select(ProductMeasure.shop_id, ProductMeasure.listing_id, ProductMeasure.variant).where(ProductMeasure.workspace_id == access.entity.workspace_id).distinct()
        if (db.scalar(select(func.count()).select_from(distinct.subquery())) or 0) >= MAX_PRODUCTS_PER_WORKSPACE:
            raise HTTPException(422, "Ürün sınırına ulaşıldı")
    changes: dict[str, tuple[float, str] | None] = {}
    for key, value in values.items():
        if key not in MEASURES:
            raise HTTPException(422, "Geçersiz ölçü")
        changes[key] = None if value is None else (_check_value(key, value), "")
    if material is not pricebook.UNSET:
        if material is not None and not (material in materials.MATERIALS and materials.MATERIALS[material].sheet):
            raise HTTPException(422, "Geçersiz malzeme türü")  # ürün levha malzemeden yapılır; ambalaj ve sarf türleri ürüne bağlanmaz
        changes[MATERIAL] = None if material is None else (0.0, material)
    for key, change in changes.items():
        row = existing.get(key)
        if change is None:
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(ProductMeasure(workspace_id=access.entity.workspace_id, shop_id=shop_id, listing_id=listing_id, variant=variant, part=part, key=key,
                                  value=change[0], text=change[1], source=source))
        else:
            row.value, row.text, row.source = change[0], change[1], source


def _prepare(db: Session, access: EntityAccess, shop_id: int, listing_id: int, variant: str) -> str:
    """Üye mi, mağaza ve ürün bu çalışma alanında mı, seçenek bu listing'e ait mi; geçerli seçeneği döner."""
    access.require_member()
    _check_shop(db, access, shop_id)
    _listing_title(db, shop_id, listing_id)
    return check_variant(db, shop_id, listing_id, variant)


def set_measures(db: Session, access: EntityAccess, shop_id: int, listing_id: int, values: dict[str, float | None], source: str = "manual",
                 variant: str = "", part: int = 0, material=pricebook.UNSET) -> dict:
    """`source`: değerler elle mi yazıldı (manual) yoksa çizimden mi alındı (cad); plaka çiziminden atanan gruplar "cad" yazar.
    `part`: ürünün hangi parçası (tek parçalı üründe 0)."""
    variant = _prepare(db, access, shop_id, listing_id, variant)
    _write(db, access, shop_id, listing_id, variant, part, values, material, source)
    db.commit()
    return _one(db, access, shop_id, listing_id, variant, part)


def measure_drawing(db: Session, access: EntityAccess, shop_id: int, listing_id: int, content: bytes, filename: str, variant: str = "", part: int = 0) -> dict:
    """Çizim dosyasını (DXF) ölçer ve ürüne yazar. Dönen `cad`, birimin varsayıldığı gibi uyarıları içerir."""
    variant = _prepare(db, access, shop_id, listing_id, variant)
    if not (filename or "").lower().endswith(".dxf"):
        raise HTTPException(415, "Yalnızca DXF çizim dosyası yüklenebilir")
    try:
        got = cad.measure_dxf(content)
    except cad.CadError as exc:
        raise HTTPException(422, str(exc)) from exc
    _write(db, access, shop_id, listing_id, variant, part, {
        "cut_length": got.cut_length_mm, "pierce_count": got.pierce_count, "width": got.width_mm or None, "height": got.height_mm or None,
        "surface": got.area_mm2 or None,
    }, pricebook.UNSET, "cad")
    db.commit()
    return {**_one(db, access, shop_id, listing_id, variant, part), "cad": got.as_dict()}


_RECOGNIZE_SIZE = 0.03  # ebat farkı
_RECOGNIZE_LENGTH = 0.05  # kesim uzunluğu farkı


def _recognize(group: dict, known: list[dict]) -> dict | None:
    """Plakadaki grubun ölçüsü, daha önce tanıtılmış bir ürünün (listing + seçenek) ölçüsüne (ebat ve kesim uzunluğu) uyuyorsa o
    ürün: aynı ürün sonraki plakalarda kendiliğinden önerilir. En yakın olan seçilir."""
    best, best_diff = None, 1.0
    g_lo, g_hi = sorted((group["width_mm"], group["height_mm"]))
    for p in known:
        v = p["values"]
        if not (v.get("width") and v.get("height") and v.get("cut_length")):
            continue
        lo, hi = sorted((v["width"], v["height"]))
        size = max(abs(g_lo - lo) / lo, abs(g_hi - hi) / hi)
        length = abs(group["cut_length_mm"] - v["cut_length"]) / v["cut_length"]
        if size <= _RECOGNIZE_SIZE and length <= _RECOGNIZE_LENGTH and size + length < best_diff:
            best, best_diff = {"shop_id": p["shop_id"], "listing_id": p["listing_id"], "variant": p["variant"], "part": p["part"], "title": p["title"]}, size + length
    return best


def analyze_sheet(db: Session, access: EntityAccess, content: bytes, filename: str, gap_mm: float) -> dict:
    """Plaka çizimini (DXF) gruplara ayırır; her grubun ölçüsü ve önizlemesiyle döner. Daha önce tanıtılmış ürünlere uyan
    gruplar `known` ile işaretlenir. Hiçbir şey kaydedilmez: kullanıcı grupları ürünlere atayınca ölçüler ürüne yazılır."""
    access.require_member()
    if not (filename or "").lower().endswith(".dxf"):
        raise HTTPException(415, "Yalnızca DXF çizim dosyası yüklenebilir")
    try:
        sheet = cad.analyze_sheet(content, gap_mm)
    except cad.CadError as exc:
        raise HTTPException(422, str(exc)) from exc
    known = list_measures(db, access)
    for g in sheet["groups"]:
        g["known"] = _recognize(g, known)
    return sheet


def remove_measures(db: Session, access: EntityAccess, shop_id: int, listing_id: int, variant: str = "", part: int | None = None) -> None:
    """Ürünü listeden çıkarır; `part` verilirse yalnızca o parçayı."""
    access.require_member()
    db.execute(delete(ProductMeasure).where(*_target(access, shop_id, listing_id, (variant or "").strip(), part)))
    db.commit()


# --------------------------------------------------------------- paylaştırma ağırlığı ----

Target = tuple[int, int, str]  # (mağaza, listing, seçenek)


def parts_for(db: Session, workspace_id: int, targets: list[Target]) -> dict[Target, list[dict]]:
    """Verilen ürünlerin (listing + seçenek) parçaları: her parça {"values": {ölçü: değer}, "material": tür anahtarı ya da None}."""
    if not targets:
        return {}
    wanted = set(targets)
    rows = [r for r in db.scalars(select(ProductMeasure).where(
        ProductMeasure.workspace_id == workspace_id, ProductMeasure.shop_id.in_(list({t[0] for t in targets})), ProductMeasure.listing_id.in_(list({t[1] for t in targets}))))
        if (r.shop_id, r.listing_id, r.variant) in wanted]
    grouped: dict[Target, dict[int, dict]] = {}
    for r in rows:
        part = grouped.setdefault((r.shop_id, r.listing_id, r.variant), {}).setdefault(r.part, {"values": {}, "material": None})
        if r.key == MATERIAL:
            part["material"] = r.text or None
        else:
            part["values"][r.key] = r.value
    return {key: [parts[n] for n in sorted(parts)] for key, parts in grouped.items()}


def part_qty(part: dict) -> float:
    """Ürünün bu parçasından kaç tane gerektiği."""
    return part["values"].get("part_qty") or 1.0


def values_for(db: Session, workspace_id: int, targets: list[Target]) -> dict[Target, dict[str, float]]:
    """Verilen ürünlerin (listing + seçenek) ölçüleri; çok parçalı üründe her parça adediyle (`part_qty`) çarpılıp toplanır: kesim uzunluğu,
    delme sayısı ve boyanan alan (yüzey alanı × boyalı yüz sayısı; yüzey alanı olmayan parça sayılmaz, hiçbir parçada yoksa ölçü yoktur)."""
    out: dict[Target, dict[str, float]] = {}
    for key, parts in parts_for(db, workspace_id, targets).items():
        total: dict[str, float] = {}
        for part in parts:
            v, q = part["values"], part_qty(part)
            for name in ("cut_length", "pierce_count"):
                if name in v:
                    total[name] = total.get(name, 0.0) + v[name] * q
            if v.get("surface"):
                total["paint_area"] = total.get("paint_area", 0.0) + v["surface"] * (v.get("sides") or 1.0) * q
        out[key] = total
    return out


def label(title: str, variant: str, listing_id: int | None = None) -> str:
    """Ekranda ve hata mesajlarında ürün adı: başlık + seçenek."""
    base = title or (f"#{listing_id}" if listing_id else "")
    return f"{base} — {variant}" if variant else base


# --------------------------------------------------------------- malzeme maliyeti (tedarikçinin fiyat listesiyle) ----



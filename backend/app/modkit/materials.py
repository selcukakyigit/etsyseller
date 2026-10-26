"""Malzeme bilgisi: metinden tür ve kalınlık tanıma, yoğunluk ve bir ürünün malzeme maliyeti tahmini. Ürünün malzemesi tür + kalınlıktır;
tedarikçinin fiyat listesindeki kalem aynı tür ve kalınlıkla eşleşir. Belgelerde, el yazısı notlarda ve çizim notlarında ("930x550 2mm Alm")
geçen yazılışla karşılaştırmak için hem kalem adından hem belge metninden aynı yolla tür ve kalınlık okunur.

Her türün bir GRUBU vardır; grup, kalemde hangi alanların ve birimlerin anlamlı olduğunu belirler (`GROUPS`, `fields_for`, `units_for`):
  sheet — LEVHA (metal, ahşap, akrilik…): yoğunluğu bilinir, ürünün parçası olur; kalınlık ve plaka boyutu anlamlıdır;
  film  — rulo/film (streç, balonlu naylon, poşet, bant): rulo eni, film kalınlığı ya da rulo boyu;
  piece — adetle sayılan (karton, kutu, strafor, kâğıt);
  bulk  — dökme / diğer (toz boya…).
Yerleşik türler burada sabittir (belge ve çizimden tanıma bunlara dayanır); kullanıcı kendi türünü ekleyebilir (bkz. `material_types.py`, anahtarı
"c<id>"): ad + grup (+ levhaysa yoğunluk). Kullanıcı türleri değişmez (yalnızca eklenir ya da silinir), bu yüzden `get` onları süreç içinde önbelleğe alabilir.
`aliases` kısaltmalardır (küçük harf, Türkçe karaktersiz — `slug` biçiminde); `density` g/cm³."""
import re
from dataclasses import dataclass

from app.modkit import units
from app.modkit.numbers import DIMS, slug

GROUPS = ("sheet", "film", "piece", "bulk")
CUSTOM_PREFIX = "c"
FALLBACK = "other"  # silinen kullanıcı türünün kalemleri buna taşınır


@dataclass(frozen=True)
class Material:
    tr: str
    en: str
    group: str
    aliases: tuple[str, ...] = ()
    density: float | None = None  # g/cm³; yalnızca levha grubunda
    builtin: bool = True

    @property
    def sheet(self) -> bool:
        return self.group == "sheet"


# anahtar → ad (tr, en), grup, belgelerde geçebilecek yazılışlar ve yoğunluk
MATERIALS: dict[str, Material] = {
    "dkp": Material("DKP / siyah sac", "Mild steel (DKP)", "sheet", ("dkp", "siyah_sac", "siyah", "black_steel", "mild_steel"), 7.85),
    "aluminium": Material("Alüminyum", "Aluminium", "sheet", ("aluminyum", "aluminium", "aluminum", "alum", "alm", "alu"), 2.70),
    "stainless": Material("Paslanmaz", "Stainless steel", "sheet", ("paslanmaz", "inox", "stainless", "krom_nikel"), 8.0),
    "chrome": Material("Krom", "Chrome", "sheet", ("krom", "chrome", "chromed"), 7.85),
    "galvanized": Material("Galvaniz", "Galvanized", "sheet", ("galvaniz", "galvanized", "galvanizli"), 7.85),
    "copper": Material("Bakır", "Copper", "sheet", ("bakir", "copper"), 8.96),
    "brass": Material("Pirinç", "Brass", "sheet", ("pirinc", "brass", "sari_metal"), 8.5),
    "wood": Material("Ahşap / MDF", "Wood / MDF", "sheet", ("ahsap", "mdf", "wood", "plywood", "kontrplak"), 0.7),
    "acrylic": Material("Akrilik", "Acrylic", "sheet", ("akrilik", "acrylic", "pleksi", "plexi"), 1.18),
    # levha olmayanlar: ambalaj ve sarf malzemeleri
    "cardboard": Material("Karton", "Cardboard", "piece", ("karton", "mukavva", "oluklu", "cardboard")),
    "paper": Material("Kâğıt", "Paper", "piece", ("kagit", "paper")),
    "bag": Material("Poşet", "Bag", "film", ("poset", "torba", "bag")),
    "box": Material("Kutu", "Box", "piece", ("kutu", "box")),
    "stretch": Material("Streç film", "Stretch film", "film", ("strec", "stretch")),
    "bubble": Material("Balonlu naylon", "Bubble wrap", "film", ("balonlu_naylon", "balonlu", "bubble")),
    "styrofoam": Material("Strafor", "Styrofoam", "piece", ("strafor", "eps", "styrofoam", "kopuk")),
    "tape": Material("Bant", "Tape", "film", ("bant", "koli_bandi", "tape")),
    "powder_paint": Material("Toz boya", "Powder paint", "bulk", ("toz_boya", "elektrostatik_boya", "powder")),
    FALLBACK: Material("Diğer", "Other", "bulk"),
}

_custom: dict[str, Material] = {}  # kullanıcı türleri (değişmez): süreç içi önbellek


def custom_key(type_id: int) -> str:
    return f"{CUSTOM_PREFIX}{type_id}"


def remember(key: str, m: Material) -> None:
    _custom[key] = m


def get(key: str | None) -> Material | None:
    """Anahtarın türü: yerleşik ya da (önbellekte yoksa veritabanından okunan) kullanıcı türü; bilinmiyorsa None. Kullanıcı türü yalnızca
    anahtarı bilinen bir kalem/üründen aranır ve anahtarlar benzersiz olduğundan başka hesabın türüne ulaşılmaz (atamada çalışma alanı doğrulanır)."""
    if not key:
        return None
    if key in MATERIALS:
        return MATERIALS[key]
    if key not in _custom and key.startswith(CUSTOM_PREFIX) and key[len(CUSTOM_PREFIX):].isdigit():
        from app.core.db import SessionLocal
        from app.modkit.models import MaterialType

        with SessionLocal() as db:
            row = db.get(MaterialType, int(key[len(CUSTOM_PREFIX):]))
            if row is not None:
                _custom[key] = Material(row.name, row.name, row.group, (), row.density, builtin=False)
    return _custom.get(key)


def group_of(key: str | None) -> str | None:
    m = get(key)
    return m.group if m else None


# Gruba göre birimler ve (birime göre) kalem alanları. Ön yüz formu bu tablodan kurar; kural yalnızca burada durur.
_MASS, _LENGTH, _AREA, _VOLUME = ("kg", "g", "t"), ("mm", "cm", "m"), ("cm2", "m2"), ("ml", "l", "m3")
_PLATE = ("thickness_mm", "plate_width", "plate_height", "plate_kg")
GROUP_UNITS: dict[str, tuple[str, ...]] = {
    "sheet": ("sheet", *_MASS, *_AREA, *_VOLUME, *_LENGTH),  # uzunluk: çıta, profil gibi metreyle alınan levha türleri
    "film": ("piece", *_MASS, *_LENGTH),  # ilk birim (adet = rulo) yeni kalemin varsayılanıdır: stok saydığın şeyle tutulur, metre türetilir
    "piece": ("piece", "sheet"),
    "bulk": (*_MASS, "piece", *_LENGTH, *_AREA, *_VOLUME),
}


def units_for(group: str | None) -> tuple[str, ...]:
    return GROUP_UNITS.get(group or "", GROUP_UNITS["bulk"])


def fields_for(group: str | None, unit: str) -> tuple[str, ...]:
    """Bu grupta ve bu birimle fiyatlanan kalemde sorulacak alanlar (`STOCK_FIELDS` altkümesi; tür her zaman sorulur). Plaka (tabaka) fiyatında
    kalınlık, plaka boyutu ve ağırlığı; kütle fiyatında aynıları (plaka boyutu ve ağırlığı isteğe bağlı); alan ve hacim fiyatında ağırlık hariç;
    film grubunda kütle fiyatı için rulo eni × kalınlığı, adet (rulo) fiyatı için rulo boyu (kg/adet → metre çevirisi, bkz. `per_metre`)."""
    u = units.UNITS.get(unit)
    if group == "sheet" and u is not None:
        return _PLATE if u.dimension in ("sheet", "mass") else _PLATE[:3] if u.dimension in ("area", "volume") else ()
    if group == "piece" and unit == "sheet":
        # tabaka olarak alınan adetli malzeme (strafor, karton): ambalaj tarifi alan payını tabaka alanına böler; kalınlık bilgidir
        return ("thickness_mm", "plate_width", "plate_height")
    if group == "film" and u is not None:
        # adet (rulo): boyu ya da (boyu yoksa) ağırlık × en × kalınlıktan hesaplanır; kütle: en × kalınlık (rulo ağırlığı paket miktarıdır)
        return ("roll_width", "film_um") if u.dimension == "mass" else ("roll_length", "roll_width", "film_um", "plate_kg") if u.dimension == "piece" else ()
    return ()


def catalog_rules() -> dict:
    """Ön yüze giden kural tablosu: grup → {units, fields: {birim: alanlar}}."""
    return {g: {"units": list(units_for(g)), "fields": {u: list(fields_for(g, u)) for u in units_for(g)}} for g in GROUPS}


MISSING_FIELDS = {"material", "thickness_mm", "plate"}  # `missing` çıktısındaki anahtarlar (ön yüz etiketler)


def missing(item) -> list[str]:
    """Kalemde maliyet ve ürün eşleşmesi için gerekli ama boş olanlar: "material" (tür yok), "thickness_mm" (levha), "plate" (tabaka fiyatında
    plaka en × boyu). Eski kalemlerde tür ve kalınlık ad/açıklamadan okunduğu için (`spec_of`) onlar eksik sayılmaz."""
    key, thick = spec_of(item)
    if key is None:
        return ["material"]
    out = []
    if group_of(key) == "sheet":
        if not thick:
            out.append("thickness_mm")
        if item.unit == "sheet" and not plate_dims(item):
            out.append("plate")
    return out


_THICKNESS = re.compile(r"(\d+(?:[.,]\d+)?)\s*mm\b", re.I)


def density(key: str | None) -> float | None:
    m = get(key)
    return m.density if m else None


def detect(text: str, sheet_only: bool = False) -> str | None:
    """Metinde geçen YERLEŞİK malzeme türü (`sheet_only`: yalnızca levha türleri); birden çok farklı tür geçiyorsa ya da hiçbiri yoksa None (emin
    değilsek söylemeyiz). Kullanıcı türleri belgelerden tanınmaz."""
    padded = f"_{slug(text)}_"
    found = {key for key, m in MATERIALS.items() if m.sheet or not sheet_only for a in m.aliases if f"_{a}_" in padded}
    return found.pop() if len(found) == 1 else None


def thicknesses(text: str) -> list[float]:
    """Metindeki kalınlıklar (mm): ebat yazılışlarındaki ("1500x700mm") sayılar kalınlık sayılmaz."""
    return [float(x.replace(",", ".")) for x in _THICKNESS.findall(DIMS.sub(" ", text or ""))]


def spec_of(item) -> tuple[str | None, float | None]:
    """Kalemin malzeme türü ve kalınlığı: alanlardan; boşsa (eski kalemler) ad ve açıklamadan okunur."""
    text = f"{item.name} {item.spec}"
    found = thicknesses(text)
    return item.material or detect(text), item.thickness_mm or (found[0] if found else None)


def plate_dims(item) -> tuple[float, float] | None:
    """Plakanın en × boyu (mm): alanlardan; boşsa kalem açıklamasındaki "1500x3000"den."""
    if item.plate_width and item.plate_height:
        return item.plate_width, item.plate_height
    m = DIMS.search(item.spec or "")
    return (float(m.group(1).replace(",", ".")), float(m.group(2).replace(",", "."))) if m else None


def plate_kg(item) -> float | None:
    """Plakanın ağırlığı (kg): yazılmışsa o, yoksa boyut × kalınlık × yoğunluk."""
    if item.plate_kg:
        return item.plate_kg
    key, thick = spec_of(item)
    dims = plate_dims(item)
    return dims[0] * dims[1] * thick * density(key) / 1e6 if density(key) and thick and dims else None


FILM_DENSITY = {"stretch": 0.92, "bag": 0.92, "bubble": 0.01}  # g/cm³: streç/poşet düz PE film; balonlu naylon hava dolu olduğundan "etkin" yoğunluk (4 mm ≈ 40 g/m²)


def _kg_per_metre(item) -> float | None:
    """Filmin 1 m'sinin ağırlığı (kg): rulo eni × film kalınlığı × yoğunluk (streç mikron, balonlu naylon mm kalınlığında; tür başına yoğunluk)."""
    density = FILM_DENSITY.get(item.material or "")
    if item.roll_width and item.film_um and density:
        return item.roll_width / 1000 * item.film_um / 1e6 * density * 1000  # m × m × m × g/cm³→kg/m³
    return None


def roll_metres(item) -> float | None:
    """Bir rulonun (ya da paketin) uzunluğu, metre; bilinemiyorsa None. Adet (rulo) biriminde: yazılmış rulo boyu, yoksa rulo ağırlığı ÷ metre ağırlığı
    (bant 100 m; balonlu naylon 14 kg × en × kalınlık → uzunluk). Kütle biriminde: paket miktarı (rulo ağırlığı) ÷ metre ağırlığı. Uzunluk biriminde: paket miktarı."""
    unit = units.UNITS.get(item.unit)
    if unit is None or item.kind != "material":
        return None
    if unit.dimension == "piece":
        if item.roll_length:
            return item.roll_length
        per_m = _kg_per_metre(item)
        return item.plate_kg / per_m if item.plate_kg and per_m else None
    if unit.dimension == "mass" and item.pack_size and (per_m := _kg_per_metre(item)):
        return units.convert(item.pack_size, item.unit, "kg") / per_m
    if unit.dimension == "length" and item.pack_size:
        return units.convert(item.pack_size, item.unit, "m")
    return None


def per_metre(item) -> float | None:
    """Rulo kalemlerinde 1 m uzunluğun kalemin BİRİMİ cinsinden karşılığı; çevrilemiyorsa None. Kütle birimli kalem (kg…): metre ağırlığı
    (`_kg_per_metre`); adet birimli kalem (rulo): 1 / rulo boyu (`roll_metres`). Böylece formülde metre yazılır, fiyat ve stok kg ya da adetle kalır."""
    unit = units.UNITS.get(item.unit)
    if unit is None or item.kind != "material":
        return None
    if unit.dimension == "mass":
        kg = _kg_per_metre(item)
        return units.convert(kg, "kg", item.unit) if kg else None
    if unit.dimension == "piece":
        metres = roll_metres(item)
        return 1 / metres if metres else None
    return None


def metres_of(item, qty: float) -> float | None:
    """Kalemin biriminde `qty` miktarının metre karşılığı (stoğun metre cinsinden görünümü); çevrilemiyorsa None."""
    per = per_metre(item)
    return qty / per if per else None


def stock_prices(item, price: float) -> dict[str, float | None]:
    """Fiyat listesindeki fiyattan (kalemin birimi başına) türetilen kg ve plaka fiyatı: {"kg", "plate"}. Kütle birimli kalem (kg, g, ton): kg
    fiyatı birimden, plaka fiyatı plaka ağırlığından; plaka (tabaka) fiyatı: kg fiyatı plaka ağırlığından; alan (m², cm²) ve hacim (m³, litre, ml)
    fiyatı: plaka fiyatı plakanın alanı ya da hacmi (kalınlıkla) kadar, kg fiyatı ona bölünen plaka ağırlığından. Hesaplanamayan None."""
    kg, dims = plate_kg(item), plate_dims(item)
    _, thick = spec_of(item)
    unit = units.UNITS.get(item.unit)
    plate = per_kg = None
    if item.unit == "sheet":
        plate = price
    elif unit is not None and unit.dimension == "mass":
        per_kg = price * units.convert(1, "kg", item.unit)
        plate = per_kg * kg if kg else None
    elif unit is not None and unit.dimension == "area" and dims:
        plate = price * units.convert(dims[0] * dims[1] / 1e6, "m2", item.unit)
    elif unit is not None and unit.dimension == "volume" and dims and thick:
        plate = price * units.convert(dims[0] * dims[1] * thick / 1e9, "m3", item.unit)
    if per_kg is None and plate is not None and kg:
        per_kg = plate / kg
    return {"kg": per_kg, "plate": plate}


def stock_kg(item, key: str | None, thickness: float | None, width_mm: float, height_mm: float) -> float | None:
    """Bir parçanın (en × boy, mm; sınır kutusu) ağırlığı (kg): tedarikçinin malzeme kaleminde plaka boyutu ve ağırlığı varsa plakadaki
    alan payı, yoksa parçanın malzeme türü ve kalınlığından alan × kalınlık × yoğunluk; hesaplanamazsa None."""
    area = width_mm * height_mm
    dims, kg = (plate_dims(item), plate_kg(item)) if item is not None else (None, None)
    if dims and kg:
        return kg * area / (dims[0] * dims[1])
    return area * thickness * density(key) / 1e6 if density(key) and thickness else None


def stock_cost(item, price: float, width_mm: float, height_mm: float) -> float | None:
    """Bir parçanın (en × boy, mm; çizimin sınır kutusu) malzeme maliyeti, fiyat listesi kaleminden; hesaplanamazsa None.
    - alan fiyatı (m², cm²): alan × fiyat;
    - plaka boyutu biliniyorsa: parçanın plakadaki alan payı × plaka fiyatı (kütle ya da hacim fiyatı plaka fiyatına çevrilir);
    - plaka boyutu yoksa: kütle fiyatı (kg, g, ton) için alan × kalınlık × yoğunluk, hacim fiyatı (m³, litre, ml) için alan × kalınlık.
    Sınır kutusu kullanılır çünkü kesimci kesilen parçanın artığını da fatura eder."""
    area = width_mm * height_mm  # mm²
    unit = units.UNITS.get(item.unit)
    if unit is not None and unit.dimension == "area":
        return price * units.convert(area / 1e6, "m2", item.unit)
    dims, prices = plate_dims(item), stock_prices(item, price)
    if dims and prices["plate"] is not None:
        return prices["plate"] * area / (dims[0] * dims[1])
    key, thick = spec_of(item)
    if unit is None or not thick:
        return None
    if unit.dimension == "volume":
        return price * units.convert(area * thick / 1e9, "m3", item.unit)
    if unit.dimension == "mass" and density(key):
        return price * units.convert(area * thick * density(key) / 1e6, "kg", item.unit)
    return None

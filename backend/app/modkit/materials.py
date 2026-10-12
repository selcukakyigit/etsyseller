"""Malzeme bilgisi: metinden tür ve kalınlık tanıma, yoğunluk ve bir ürünün malzeme maliyeti tahmini. Ürünün malzemesi tür + kalınlıktır;
tedarikçinin fiyat listesindeki kalem aynı tür ve kalınlıkla eşleşir. Belgelerde, el yazısı notlarda ve çizim notlarında ("930x550 2mm Alm")
geçen yazılışla karşılaştırmak için hem kalem adından hem belge metninden aynı yolla tür ve kalınlık okunur.

İki grup vardır: LEVHA malzemeler (metal, ahşap, akrilik…; yoğunluğu bilinir, ürünün parçası olur, kalınlık ve plaka boyutu anlamlıdır) ve
diğerleri (ambalaj, boya… yoğunluk yok; yalnızca fiyat listesinde adet/kg/metre kalemi olarak durur, ürüne bağlanmaz).
`aliases` kısaltmalardır (küçük harf, Türkçe karaktersiz — `slug` biçiminde); `density` g/cm³."""
import re
from dataclasses import dataclass

from app.modkit import units
from app.modkit.numbers import DIMS, slug


@dataclass(frozen=True)
class Material:
    aliases: tuple[str, ...]
    density: float | None = None  # g/cm³; yoksa levha malzeme değildir

    @property
    def sheet(self) -> bool:
        return self.density is not None


# anahtar → belgelerde geçebilecek yazılışlar ve yoğunluk
MATERIALS: dict[str, Material] = {
    "dkp": Material(("dkp", "siyah_sac", "siyah", "black_steel", "mild_steel"), 7.85),
    "aluminium": Material(("aluminyum", "aluminium", "aluminum", "alum", "alm", "alu"), 2.70),
    "stainless": Material(("paslanmaz", "inox", "stainless", "krom_nikel"), 8.0),
    "chrome": Material(("krom", "chrome", "chromed"), 7.85),
    "galvanized": Material(("galvaniz", "galvanized", "galvanizli"), 7.85),
    "copper": Material(("bakir", "copper"), 8.96),
    "brass": Material(("pirinc", "brass", "sari_metal"), 8.5),
    "wood": Material(("ahsap", "mdf", "wood", "plywood", "kontrplak"), 0.7),
    "acrylic": Material(("akrilik", "acrylic", "pleksi", "plexi"), 1.18),
    # levha olmayanlar: ambalaj ve sarf malzemeleri
    "cardboard": Material(("karton", "mukavva", "oluklu", "cardboard")),
    "paper": Material(("kagit", "paper")),
    "bag": Material(("poset", "torba", "bag")),
    "box": Material(("kutu", "box")),
    "stretch": Material(("strec", "stretch")),
    "bubble": Material(("balonlu_naylon", "balonlu", "bubble")),
    "styrofoam": Material(("strafor", "eps", "styrofoam", "kopuk")),
    "tape": Material(("bant", "koli_bandi", "tape")),
    "powder_paint": Material(("toz_boya", "elektrostatik_boya", "powder")),
    "other": Material(()),
}

_THICKNESS = re.compile(r"(\d+(?:[.,]\d+)?)\s*mm\b", re.I)


def _density(key: str | None) -> float | None:
    return MATERIALS[key].density if key in MATERIALS else None


def detect(text: str, sheet_only: bool = False) -> str | None:
    """Metinde geçen malzeme türü (`sheet_only`: yalnızca levha türleri); birden çok farklı tür geçiyorsa ya da hiçbiri yoksa None (emin
    değilsek söylemeyiz)."""
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
    return dims[0] * dims[1] * thick * _density(key) / 1e6 if _density(key) and thick and dims else None


FILM_DENSITY = {"stretch": 0.92, "bag": 0.92, "bubble": 0.01}  # g/cm³: streç/poşet düz PE film; balonlu naylon hava dolu olduğundan "etkin" yoğunluk (4 mm ≈ 40 g/m²)


def per_metre(item) -> float | None:
    """Rulo kalemlerinde 1 m uzunluğun kalemin BİRİMİ cinsinden karşılığı; çevrilemiyorsa None. Kütle birimli kalem (kg…): rulo eni × film
    kalınlığı × yoğunluk (streç mikron, balonlu naylon mm kalınlığında; tür başına yoğunluk); adet birimli kalem (bant rulosu): 1 / rulo boyu. Böylece formülde metre yazılır, fiyat kg ya da
    adetten hesaplanır."""
    unit = units.UNITS.get(item.unit)
    if unit is None or item.kind != "material":
        return None
    density = FILM_DENSITY.get(item.material or "")
    if unit.dimension == "mass" and item.roll_width and item.film_um and density:
        kg = item.roll_width / 1000 * item.film_um / 1e6 * density * 1000  # m × m × m × g/cm³→kg/m³
        return units.convert(kg, "kg", item.unit)
    if unit.dimension == "piece" and item.roll_length:
        return 1 / item.roll_length
    return None


def stock_prices(item, price: float) -> dict[str, float | None]:
    """Fiyat listesinde kg ya da plaka (levha) fiyatı yazılır, diğeri plaka ağırlığından türetilir: {"kg", "plate"}."""
    kg = plate_kg(item)
    if item.unit == "kg":
        return {"kg": price, "plate": price * kg if kg else None}
    if item.unit == "sheet":
        return {"kg": price / kg if kg else None, "plate": price}
    return {"kg": None, "plate": None}


def stock_kg(item, key: str | None, thickness: float | None, width_mm: float, height_mm: float) -> float | None:
    """Bir parçanın (en × boy, mm; sınır kutusu) ağırlığı (kg): tedarikçinin malzeme kaleminde plaka boyutu ve ağırlığı varsa plakadaki
    alan payı, yoksa parçanın malzeme türü ve kalınlığından alan × kalınlık × yoğunluk; hesaplanamazsa None."""
    area = width_mm * height_mm
    dims, kg = (plate_dims(item), plate_kg(item)) if item is not None else (None, None)
    if dims and kg:
        return kg * area / (dims[0] * dims[1])
    return area * thickness * _density(key) / 1e6 if _density(key) and thickness else None


def stock_cost(item, price: float, width_mm: float, height_mm: float) -> float | None:
    """Bir parçanın (en × boy, mm; çizimin sınır kutusu) malzeme maliyeti, fiyat listesi kaleminden; hesaplanamazsa None.
    - m2: alan × fiyat;
    - plaka boyutu biliniyorsa: parçanın plakadaki alan payı × plaka fiyatı (kg fiyatıysa plaka ağırlığıyla plaka fiyatına çevrilir);
    - plaka boyutu yoksa (kg): parça ağırlığı (alan × kalınlık × yoğunluk) × kg fiyatı.
    Sınır kutusu kullanılır çünkü kesimci kesilen parçanın artığını da fatura eder."""
    area = width_mm * height_mm  # mm²
    if item.unit == "m2":
        return price * area / 1e6
    dims, prices = plate_dims(item), stock_prices(item, price)
    if dims and prices["plate"] is not None:
        return prices["plate"] * area / (dims[0] * dims[1])
    key, thick = spec_of(item)
    if item.unit == "kg" and _density(key) and thick:
        return price * area * thick * _density(key) / 1e6
    return None

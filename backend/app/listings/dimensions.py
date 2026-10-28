"""Ölçü metinleri ("35x45", '35"x45"', "30 x 47 in", "100 cm") ve ölçü varyasyonları.

Tek yer: varyasyon seçeneği etiketlerini düzenler, birim yoksa mağazanın alışkanlığından tahmin eder, bir "Size" varyasyonunun hangi
Genişlik/Yükseklik/Derinlik özelliklerini karşıladığını söyler (karşılananlar özellik olarak tek değerle doldurulmaz)."""
import re
from collections import Counter
from dataclasses import dataclass

# birim eşanlamlıları -> kısa kod
_UNITS = {
    "mm": "mm", "millimeter": "mm", "millimeters": "mm", "milimetre": "mm",
    "cm": "cm", "centimeter": "cm", "centimeters": "cm", "santim": "cm", "santimetre": "cm",
    "m": "m", "meter": "m", "meters": "m", "metre": "m",
    "in": "in", "inch": "in", "inches": "in", "inç": "in", '"': "in", "”": "in", "″": "in", "''": "in",
    "ft": "ft", "foot": "ft", "feet": "ft", "'": "ft",
}
SCALE_NAMES = {"mm": "Millimeters", "cm": "Centimeters", "m": "Meters", "in": "Inches", "ft": "Feet"}
# Etsy'de sırayla Genişlik x Yükseklik x Derinlik
AXES = ("Width", "Height", "Depth")

_NUM = r"\d+(?:[.,]\d+)?"
_UNIT = r"(?:mm|millimeters?|milimetre|cm|centimeters?|santim(?:etre)?|inch(?:es)?|inç|in|ft|feet|foot|m(?:eters?|etre)?|[\"”″']{1,2})"
_PART = re.compile(rf"^\s*({_NUM})\s*({_UNIT})?\s*$", re.IGNORECASE)
_SPLIT = re.compile(r"\s*(?:x|×|\*|by)\s*", re.IGNORECASE)
# "XL Model : 30" x 47"" gibi önek ve "(cm)" gibi sonek temizlenir
_PREFIX = re.compile(r"^[^:\d]*:\s*")
_PAREN = re.compile(r"\(([^)]*)\)\s*$")


@dataclass(frozen=True)
class Dims:
    values: tuple[float, ...]
    unit: str | None  # "mm" | "cm" | "m" | "in" | "ft" | None (belirtilmemiş)

    def label(self, unit: str | None = None) -> str:
        """Seçenek etiketi: 35" x 45" (inç), 35 x 45 cm (metrik)."""
        u = self.unit or unit
        nums = [f"{v:g}" for v in self.values]
        if u == "in":
            return " x ".join(f'{n}"' for n in nums)
        return " x ".join(nums) + (f" {u}" if u else "")


def parse(text: str) -> Dims | None:
    """"35x45" → Dims((35, 45), None); '35"x45"' → inç; "100 cm" → tek ölçü. Ölçü değilse None."""
    s = str(text or "").strip()
    if not s:
        return None
    s = _PREFIX.sub("", s)
    trailing = None
    m = _PAREN.search(s)
    if m and _UNITS.get(m.group(1).strip().lower()):
        trailing, s = _UNITS[m.group(1).strip().lower()], s[: m.start()].strip()
    parts = _SPLIT.split(s) if re.search(rf"\d\s*{_UNIT}?\s*(?:x|×|\*|by)\s*\d", s, re.IGNORECASE) else [s]
    if not 1 <= len(parts) <= 3:
        return None
    nums, units = [], []
    for p in parts:
        mm = _PART.match(p)
        if mm is None:
            return None
        nums.append(float(mm.group(1).replace(",", ".")))
        units.append(_UNITS.get((mm.group(2) or "").lower()) if mm.group(2) else None)
    given = {u for u in units if u}
    if len(given) > 1:
        return None
    return Dims(tuple(nums), (given.pop() if given else None) or trailing)


def parse_all(options: list[str]) -> list[Dims] | None:
    """Tüm seçenekler ölçüyse ve boyut sayıları aynıysa liste, değilse None."""
    out = [parse(o) for o in options]
    if not out or any(d is None for d in out) or len({len(d.values) for d in out}) != 1:
        return None
    return out  # type: ignore[return-value]


def shop_unit(option_lists: list[list[str]], currency: str = "USD") -> str:
    """Mağazanın ölçü alışkanlığı: mevcut varyasyon seçeneklerinde en çok kullanılan birim; yoksa ABD (USD) için inç, diğerleri için cm."""
    seen: Counter = Counter()
    for opts in option_lists:
        for d in (parse(o) for o in opts):
            if d is not None and d.unit and len(d.values) > 1:
                seen[d.unit] += 1
    if seen:
        return seen.most_common(1)[0][0]
    return "in" if currency == "USD" else "cm"


def normalize_options(options: list[str], default_unit: str) -> tuple[list[str], str | None]:
    """Ölçü seçeneklerini tek biçime getirir. Birimi olmayanlara default_unit atanır. Döner: (etiketler, varsayılan birim kullanıldıysa o birim).
    Hepsi ölçü değilse ya da seçenekte zaten başka birimler karışıksa dokunulmaz."""
    dims = parse_all(options)
    if dims is None or (len(dims[0].values) == 1 and any(d.unit is None for d in dims)):
        return options, None  # tek sayı ("50") hangi ölçü olduğu belli olmadığından tahmin edilmez
    if any(_PREFIX.match(o) for o in options):
        return options, None  # "XL Model : 30" x 47"" gibi adlı seçeneklerin adı korunur
    given = {d.unit for d in dims if d.unit}
    unit = next(iter(given)) if len(given) == 1 else default_unit  # birimi yazılanlar varsa eksik olanlar onunla aynı sayılır
    missing = any(d.unit is None for d in dims)
    return [d.label(unit) for d in dims], (unit if missing and not given else None)


def axes_covered(options: list[str]) -> tuple[str, ...]:
    """Ölçü varyasyonu bu seçeneklerle hangi özellikleri karşılıyor: 2 ölçü → (Width, Height), 3 → (Width, Height, Depth). Ölçü değilse ()."""
    dims = parse_all(options)
    if dims is None or any(d.unit is None for d in dims):
        return ()
    if len(dims[0].values) < 2:  # "50 cm / 70 cm": hangi ölçü olduğu belli değil, tek doğrusal ölçü alanlarının hepsi varyasyonda sayılır
        return ("Width", "Height", "Length", "Diameter")
    return AXES[: len(dims[0].values)] + ("Length",)


def scale_for(unit: str, scales: list[dict]) -> dict | None:
    """Etsy özelliğinin birim listesinden (display_name: Inches, Millimeters…) kısa koda karşılık geleni."""
    want = SCALE_NAMES.get(unit, "").lower()
    return next((s for s in scales if str(s.get("display_name", "")).lower() == want), None)


def mentioned(option: str, text: str) -> bool:
    """Ölçü seçeneği ("35 x 45 cm") metinde başka yazılışla geçiyor mu ("35x45 cm", '35" x 45"', "35 × 45")? Ölçü değilse False."""
    d = parse(re.sub(r"[(][^)]*[)]", "", option).strip()) or parse(option)  # "140 x 49 cm (55 x 19.3 in)": parantezdeki inç karşılığı ana ölçünün yazılışını bozmaz
    if d is None:
        return False
    sep = r"\s*(?:x|×|\*|by)\s*"
    pattern = sep.join(rf"{re.escape(f'{v:g}')}\s*(?:{_UNIT})?" for v in d.values)
    return bool(re.search(rf"(?<![\d.,]){pattern}(?![\d])", str(text), re.IGNORECASE))


_THICK = re.compile(rf"(?:thickness|thick|depth|deep|kalınlık\w*)\D{{0,12}}?({_NUM})\s*({_UNIT})|({_NUM})\s*({_UNIT})[\s-]*(?:thick|deep)\b", re.IGNORECASE)


def depth_from_text(text: str) -> tuple[float, str] | None:
    """Metinde açıkça yazan kalınlık/derinlik ("2 mm thickness", "1.5 inch deep"); yoksa None (uydurulmaz)."""
    m = _THICK.search(str(text or ""))
    if not m:
        return None
    num, unit = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
    code = _UNITS.get(unit.lower())
    return (float(num.replace(",", ".")), code) if code else None


_NAME_ONLY = re.compile(r"^\s*([A-Za-z0-9]{1,5})\b\s*[-–:]?\s*(.*)$")


def fill_missing_sizes(labels: list[str]) -> list[str]:
    """Kullanıcı yalnızca bazı boyutları verip ötekilerini "orantıla" dediğinde (ör. M ve XL belli, S ve XXL istenen): ölçüsü olmayan seçenekler, ölçüsü belli olanların
    SIRALARINDAKİ eşit artıştan hesaplanır (S = M - (XL - M), XXL = XL + (XL - M)). En az iki ölçülü seçenek, aynı birim, tek yönlü artış şart; yoksa etiketler aynen döner.
    Etiket biçimi ölçülülerinkiyle aynı olur: "S - 83x55 cm (32.7 x 21.7 in)"."""
    known: dict[int, tuple[str, Dims, bool]] = {}
    missing: list[tuple[int, str]] = []
    for i, label in enumerate(labels):
        m = _NAME_ONLY.match(str(label))
        if not m:
            return labels
        name, rest = m.group(1), m.group(2)
        core = re.sub(r"\s*\([^)]*\)\s*$", "", rest).strip()
        if re.search(r"\d", core):
            dims = parse(core)
            if dims is None or len(dims.values) != 2 or dims.unit not in ("cm", "mm"):
                return labels
            known[i] = (name, dims, "(" in rest and bool(re.search(r"\bin\b", rest)))
        elif not re.search(r"\d", rest):
            missing.append((i, name))
        else:
            return labels
    if len(known) < 2 or not missing or len({k[1].unit for k in known.values()}) != 1:
        return labels
    idx = sorted(known)
    (i1, (_n1, d1, _w1)), (i2, (_n2, d2, _w2)) = (idx[0], known[idx[0]]), (idx[-1], known[idx[-1]])
    step = [(b - a) / (i2 - i1) for a, b in zip(d1.values, d2.values)]
    if not all(x > 0 for x in step) and not all(x < 0 for x in step):
        return labels
    unit, with_in = d1.unit, any(k[2] for k in known.values())
    out = list(labels)
    for i, name in missing:
        values = [round(a + (i - i1) * st, 1) for a, st in zip(d1.values, step)]
        if any(v <= 0 for v in values):
            return labels
        text = f"{name} - " + " x ".join(f"{v:g}" for v in values).replace(" x ", "x") + f" {unit}"
        if with_in and unit == "cm":
            text += f" ({values[0] / 2.54:.1f} x {values[1] / 2.54:.1f} in)"
        out[i] = text
    return out


MAX_OPTION_CHARS = 20  # Etsy varyasyon seçenek adı sınırı (düzenleyicideki "seçenek ekle" kutusu)
_NAMED_CM = re.compile(r"^\s*(?:([A-Za-z][A-Za-z0-9]{0,3}|[2-5]XL)\s*[-–:]?\s*)?(\d+(?:[.,]\d+)?)\s*[x×X]\s*(\d+(?:[.,]\d+)?)\s*cm")


def compact_sizes(labels: list[str]) -> list[str]:
    """20 karakteri aşan cm ölçü etiketlerini ("S - 83x55 cm (32.7 x 21.7 in)") sığacak en zengin biçime indirir: tüm seçenekler AYNI biçimi kullanır, cm ve inç birlikte kalır
    ("S 83x55cm/33x22in"); hiçbiri sığmazsa inç atılır. Hepsi sığıyorsa ya da cm ölçüsü olmayan etiket varsa aynen döner."""
    if all(len(x) <= MAX_OPTION_CHARS for x in labels):
        return labels
    parsed = []
    for label in labels:
        m = _NAMED_CM.match(str(label))
        if not m:
            return labels
        parsed.append((m.group(1) or "", float(m.group(2).replace(",", ".")), float(m.group(3).replace(",", "."))))

    def build(kind: int) -> list[str]:
        out = []
        for name, w, h in parsed:
            head = f"{name} " if name else ""
            iw, ih = w / 2.54, h / 2.54
            if kind == 0:
                out.append(f"{head}{w:g}x{h:g}cm/{iw:.1f}x{ih:.1f}in")
            elif kind == 1:
                out.append(f"{head}{w:g}x{h:g}cm/{iw:.0f}x{ih:.0f}in")
            elif kind == 2:
                out.append(f"{head}{w:g}x{h:g}cm/{iw:.0f}x{ih:.0f}")
            else:
                out.append(f"{head}{w:g}x{h:g} cm")
        return out

    for kind in range(4):
        candidate = build(kind)
        if all(len(x) <= MAX_OPTION_CHARS for x in candidate):
            return candidate
    return labels

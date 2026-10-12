"""Belgedeki sayıların okunması: para tutarları (her ayraç düzeni), süreler ("25min4,8s", "1h 2m", "00:25:04"),
metinden kısa anahtar üretimi. Saf fonksiyonlar."""
import re

_TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def parse_amount(v) -> tuple[float | None, bool]:
    """Para tutarı okuyucu: 1250 · 1,250 · 1.250 · 1 250 · 1'250 · 1.250,50 · 1,250.50 · ₺/$/TL/USD gibi eklerle.
    Döner: (değer, belirsiz mi). İki ayraç varsa sonuncusu ondalıktır; tek ayraçta ve ardında TAM 3 hane varsa
    ("1,250" / "1.250") para tutarında 3 ondalık olmayacağından binlik sayılır ama BELİRSİZ işaretlenir (fatura toplamıyla
    çapraz kontrol edilir); 1-2 hane ondalıktır; aynı ayraç birden fazlaysa binliktir."""
    if v is None or v == "":
        return None, False
    if isinstance(v, bool):
        return None, False
    if isinstance(v, (int, float)):
        return float(v), False
    s = re.sub(r"[^\d,.\-\s'’ ]", "", str(v))
    neg = "-" in s
    s = re.sub(r"[\s'’ -]", "", s)
    if not s or not any(ch.isdigit() for ch in s):
        return None, False
    ambiguous = False
    if "," in s and "." in s:
        dec = "," if s.rfind(",") > s.rfind(".") else "."
        s = s.replace("." if dec == "," else ",", "").replace(dec, ".")
    elif "," in s or "." in s:
        sep = "," if "," in s else "."
        parts = s.split(sep)
        if len(parts) > 2:
            s = "".join(parts)
        else:
            head, tail = parts
            if len(tail) == 3 and head not in ("", "0") and len(head) <= 3:
                s, ambiguous = head + tail, True
            else:
                s = (head or "0") + "." + tail
    try:
        val = float(s)
    except ValueError:
        return None, False
    return (-val if neg else val), ambiguous


def to_float(v) -> float | None:
    return parse_amount(v)[0]


def parse_measure(v) -> float | None:
    """Ölçü değeri (para değil): "1,5" ve "1.5" ondalıktır, binlik yorumu yapılmaz ("2,500 kg" → 2.5 değil 2500 olabilir
    ama ölçülerde virgül pratikte hep ondalıktır)."""
    if v is None or v == "" or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:[.,]\d+)?", str(v).replace(" ", "").replace(" ", ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", "."))
    except ValueError:
        return None


_DUR_PART = re.compile(r"(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours|sa|saat|min|mins|minute|minutes|dk|dak|s|sec|secs|second|seconds|sn|saniye)\b", re.I)
_CLOCK = re.compile(r"^\s*(\d{1,3}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?\s*$")
_SEC = {"h": 3600, "hr": 3600, "hrs": 3600, "hour": 3600, "hours": 3600, "sa": 3600, "saat": 3600,
        "min": 60, "mins": 60, "minute": 60, "minutes": 60, "dk": 60, "dak": 60,
        "s": 1, "sec": 1, "secs": 1, "second": 1, "seconds": 1, "sn": 1, "saniye": 1}


def parse_duration(text) -> float | None:
    """Süreyi saniyeye çevirir: "25min4,8s" → 1504.8 · "1h2min" → 3720 · "00:25:04" → 1504. Süre değilse None."""
    if text is None:
        return None
    s = str(text).strip()
    m = _CLOCK.match(s)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if m.group(3) is None:  # "25:04" — rapor sürelerinde dakika:saniye
            return a * 60.0 + b
        return a * 3600.0 + b * 60 + float(m.group(3).replace(",", "."))
    # "25min4,8s" gibi bitişik yazımda \b birim sonrası rakamla çalışmaz; aradaki rakamlardan önce boşluk aç.
    spaced = re.sub(r"([a-zA-Z])(?=\d)", r"\1 ", s)
    parts = _DUR_PART.findall(spaced)
    if not parts:
        return None
    rest = _DUR_PART.sub("", spaced).strip(" ,;")
    if rest:  # süre dışında metin var ("2 mm" gibi) — süre sayma
        return None
    return sum(float(v.replace(",", ".")) * _SEC[u.lower()] for v, u in parts)


# "930x550", "1500 × 300": belgelerde ve notlarda ebat yazılışı (en × boy)
DIMS = re.compile(r"(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)", re.I)


def slug(text: str, limit: int = 80) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").translate(_TR).lower()).strip("_")
    return s[:limit]

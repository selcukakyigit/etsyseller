"""Birimler ve dönüşüm. Her birim bir boyuta (süre, kütle, uzunluk…) ve o boyutun temel birimine göre çarpana sahiptir.
Aynı boyuttaki birimler birbirine çevrilebilir (rapor saniye verir, fiyat dakika başına girilmiş olabilir).

Sayılabilir birimler (adet, tabaka, plaka, iş) kendi başına bir boyuttur: "1 tabaka" "1 adet"e çevrilmez.
Etiketler ön yüzde iki dilde tutulur; burada yalnızca kodlar vardır."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Unit:
    code: str
    dimension: str
    factor: float  # 1 birim = factor × boyutun temel birimi


_UNITS = [
    Unit("s", "time", 1), Unit("min", "time", 60), Unit("h", "time", 3600),
    Unit("g", "mass", 0.001), Unit("kg", "mass", 1), Unit("t", "mass", 1000),
    Unit("mm", "length", 0.001), Unit("cm", "length", 0.01), Unit("m", "length", 1),
    Unit("cm2", "area", 0.0001), Unit("m2", "area", 1),
    Unit("ml", "volume", 0.001), Unit("l", "volume", 1), Unit("m3", "volume", 1000),
    Unit("piece", "piece", 1), Unit("sheet", "sheet", 1), Unit("job", "job", 1),
]
UNITS: dict[str, Unit] = {u.code: u for u in _UNITS}
CODES = tuple(UNITS)


class UnitError(ValueError):
    pass


def get(code: str) -> Unit:
    try:
        return UNITS[code]
    except KeyError as exc:
        raise UnitError(f"Bilinmeyen birim: {code}") from exc


def compatible(a: str, b: str) -> bool:
    return a in UNITS and b in UNITS and UNITS[a].dimension == UNITS[b].dimension


def convert(value: float, src: str, dst: str) -> float:
    """`value` src biriminden dst birimine. Boyutlar farklıysa UnitError."""
    s, d = get(src), get(dst)
    if s.dimension != d.dimension:
        raise UnitError(f"{src} → {dst} çevrilemez")
    return value * s.factor / d.factor

"""Hesaplama motoru: iş satırlarından tutar. Saf fonksiyonlar (veritabanı yok) — her modül kendi satırlarını verir.

    net      = Σ satır tutarı (+ minimuma tamamlama)
    KDV      = net × oran
    toplam   = net + KDV
    maliyet  = KDV maliyete dahilse toplam, değilse net (KDV indirilebiliyorsa maliyet değildir)
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Totals:
    lines: float
    minimum_adjust: float
    net: float
    vat: float
    total: float

    def as_dict(self) -> dict:
        return {"lines": self.lines, "minimum_adjust": self.minimum_adjust, "net": self.net, "vat": self.vat, "total": self.total}


def r2(x: float) -> float:
    return round(x + 0.0, 2)


def line_amount(qty: float, unit_price: float) -> float:
    return r2(float(qty) * float(unit_price))


def percent_fee(base: float, percent: float, minimum: float | None) -> float:
    """Yüzdelik ücret: `base` tutarının yüzdesi, kalemin "en az" tutarından küçükse o; taban sıfırsa (işte satır yok) ücret de yok."""
    if base <= 0:
        return 0.0
    return r2(max(base * float(percent or 0) / 100, float(minimum or 0)))


def totals(line_amounts: list[float], minimum: float | None, vat_rate: float) -> Totals:
    s = r2(sum(line_amounts))
    adjust = r2(minimum - s) if minimum and s < minimum and s > 0 else 0.0
    net = r2(s + adjust)
    vat = r2(net * (vat_rate or 0) / 100)
    return Totals(lines=s, minimum_adjust=adjust, net=net, vat=vat, total=r2(net + vat))


def with_vat(net: float, vat_rate: float) -> tuple[float, float]:
    vat = r2(net * (vat_rate or 0) / 100)
    return vat, r2(net + vat)


def cost_basis(net: float, vat_rate: float, vat_in_cost: bool) -> float:
    return with_vat(net, vat_rate)[1] if vat_in_cost else r2(net)

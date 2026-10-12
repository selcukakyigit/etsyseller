"""İşin para biriminden mağazanın rapor para birimine geçmiş tarihli kur (aynı gün için bellekte tutulur)."""
import datetime as dt

from fastapi import HTTPException

from app.core.i18n import tr


_FX_CACHE: dict[tuple[str, str, dt.date], float] = {}  # geçmiş tarihli kurlar değişmez


def rate(currency: str, report_ccy: str, on: dt.date) -> float:
    """1 iş para birimi = kaç rapor para birimi, işin tarihindeki kurla. Kur alınamazsa hata verir: TL tutarın sessizce dolar sayılması
    (kur 1,0) maliyeti yüzlerce kat bozar."""
    from app.finance.invoices import resolve_fx

    if currency == report_ccy:
        return 1.0
    key = (currency, report_ccy, on)
    if key not in _FX_CACHE:
        _, rate, source = resolve_fx(currency, 1.0, on.isoformat(), report_ccy, None)
        if source.startswith("kur alınamadı"):
            raise HTTPException(503, tr(f"{on:%d.%m.%Y} tarihli {currency}/{report_ccy} kuru alınamadı; biraz sonra tekrar dene.",
                                        f"The {currency}/{report_ccy} rate for {on:%d.%m.%Y} could not be fetched; try again shortly."))
        _FX_CACHE[key] = rate
    return _FX_CACHE[key]

"""Modüllerde seçilebilecek para birimleri — tek kaynak. Doğrulama (entities), uç nokta (/api/modkit/currencies) ve ön yüz
seçicisi (modules/components/CurrencySelect) buradan beslenir.

Liste, kurunu tarihe göre bulabildiğimiz para birimleridir (finance/invoices.resolve_fx → Frankfurter): bir işin
maliyeti mağazanın rapor para birimine bu kurla çevrilir. Listede olmayan bir kod çevrilemez, maliyet yanlış birimle
yazılırdı."""
from fastapi import HTTPException

CURRENCIES: tuple[str, ...] = (
    "TRY", "USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN",
    "ISK", "JPY", "CNY", "HKD", "SGD", "KRW", "INR", "IDR", "MYR", "PHP", "THB", "ILS", "MXN", "BRL", "ZAR",
)
DEFAULT = "TRY"


def clean(code: str | None) -> str:
    """Geçerli koda çevirir; listede yoksa 422."""
    c = (code or DEFAULT).strip().upper()
    if c not in CURRENCIES:
        raise HTTPException(422, "Geçersiz para birimi")
    return c

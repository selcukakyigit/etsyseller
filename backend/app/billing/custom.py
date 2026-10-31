"""Özel kredi miktarı ve paket indirimleri: fiyatın tek kaynağı. Ekran yalnızca kredi miktarı gönderir; fiyatı burada hesaplarız ve ödeme sağlayıcısına
biz veririz (istemciden gelen tutara güvenilmez).

Kredi başına fiyat satıştaki paketlerden çıkar: en küçük paket "liste fiyatı"dır (indirimsiz). Bir miktarın fiyatı, miktarı aşmayan en büyük paketin
kredi başına fiyatıyla hesaplanır; küçük paketin altındaki miktarlar liste fiyatıdır. Böylece "Popular" ve "Power" paketleri ile özel miktar aynı basamak
tablosunu kullanır ve yönetici bir paketin fiyatını değiştirince hepsi birlikte güncellenir."""
import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.billing.models import BillingProduct

# Ödeme sağlayıcısının sabit işlem ücreti (ör. 0,50 $) küçük alımları orantısız yer: 100 kredi (~1 $) için komisyon %50'yi aşar, 500 kredi (~5 $) için ~%15.
MIN_CREDITS = 500
MAX_CREDITS = 100_000
# Bu yüzdenin altındaki fark gösterilmez (yuvarlama gürültüsü).
MIN_SHOWN_DISCOUNT_PCT = 3


class CustomError(Exception):
    pass


@dataclass(frozen=True)
class Tier:
    from_credits: int
    rate: float  # kredi başına fiyat (kuruş / sent)
    discount_pct: int


def active_products(db: Session) -> list[BillingProduct]:
    rows = db.scalars(select(BillingProduct).where(BillingProduct.active.is_(True))).all()
    return sorted((p for p in rows if p.credits > 0 and p.price_cents > 0), key=lambda p: (p.credits, p.id))


def tiers(products: list[BillingProduct]) -> list[Tier]:
    """Basamaklar, küçükten büyüğe. İlk basamak liste fiyatıdır (indirim 0); yalnızca gerçekten indirimli olanlar eklenir."""
    if not products:
        return []
    base = products[0].price_cents / products[0].credits
    out = [Tier(products[0].credits, base, 0)]
    for p in products[1:]:
        rate = p.price_cents / p.credits
        pct = round((1 - rate / base) * 100)
        if pct >= MIN_SHOWN_DISCOUNT_PCT:
            out.append(Tier(p.credits, rate, pct))
    return out


def pack_discount(products: list[BillingProduct], product: BillingProduct) -> tuple[int, int]:
    """(liste fiyatı, indirim %) — paketin indirimsiz karşılığı ve ona göre indirimi. En küçük pakette indirim 0."""
    if not products:
        return product.price_cents, 0
    base = products[0].price_cents / products[0].credits
    list_price = math.ceil(product.credits * base)
    pct = round((1 - product.price_cents / list_price) * 100) if list_price > 0 else 0
    return (list_price, pct) if pct >= MIN_SHOWN_DISCOUNT_PCT else (product.price_cents, 0)


def quote(db: Session, credits: int) -> dict:
    """Özel miktarın fiyatı. Miktar sınırların dışındaysa veya paket yoksa `CustomError`."""
    if not MIN_CREDITS <= credits <= MAX_CREDITS:
        raise CustomError("range")
    products = active_products(db)
    ladder = tiers(products)
    if not ladder:
        raise CustomError("no_products")
    tier = max((t for t in ladder if t.from_credits <= credits), key=lambda t: t.from_credits, default=ladder[0])
    list_price = math.ceil(credits * ladder[0].rate)
    price = math.ceil(credits * tier.rate)
    pct = round((1 - price / list_price) * 100) if list_price > 0 and price < list_price else 0
    return {
        "credits": credits,
        "price_cents": price,
        "list_price_cents": list_price,
        "discount_pct": pct if pct >= MIN_SHOWN_DISCOUNT_PCT else 0,
        "currency": products[0].currency,
    }


def info(db: Session) -> dict:
    """Ekranın göstereceği sınırlar ve basamaklar."""
    products = active_products(db)
    return {
        "min": MIN_CREDITS,
        "max": MAX_CREDITS,
        "tiers": [{"from_credits": t.from_credits, "discount_pct": t.discount_pct} for t in tiers(products) if t.discount_pct > 0],
    }

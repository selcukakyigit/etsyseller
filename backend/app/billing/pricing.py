"""Bir AI işleminin fiyatı: sağlayıcı maliyeti (USD) ve kullanıcıdan düşülecek kredi.

Kural: sağlayıcı payı = maliyet × kâr çarpanı ÷ bir kredinin USD değeri, yukarı yuvarlanır, en az MIN_CREDITS; üstüne her işlemde sabit
platform payı eklenir (`platform_fee`: sunucu ve veritabanı gibi sabit giderler). Kullanıcıdan düşülen = ikisinin toplamı; defterde ayrı tutulur.

- Metin modelleri token başına fiyatlanır (modelin girdi/çıktı fiyatı); kredi çağrıdan sonra, gerçek token sayısıyla hesaplanır.
  Yönetici modele sabit çağrı kredisi yazarsa sağlayıcı payı o olur.
- Görsel/video modelleri seçenek (variant) başına sabit fiyatlanır: birim kredisi (görsel ya da video saniyesi başına) önce yuvarlanır, sonra
  birim sayısıyla çarpılır; platform payı üretim başına bir kez eklenir. Böylece kullanıcıya üretmeden önce gösterilen tutar ("720p · 5 sn =
  21 kredi") ile düşülen tutar her zaman aynıdır. Yönetici birim kredisini elle sabitlemişse o kullanılır."""
import math
from dataclasses import dataclass

from app.ai.catalog import ResolvedModel, Variant
from app.billing.settings import DEFAULTS, setting

MIN_CREDITS = 1


@dataclass(frozen=True)
class Price:
    cost_usd: float
    provider: int  # sağlayıcı payı (kredi)
    platform: int  # sabit platform payı (kredi)

    @property
    def credits(self) -> int:
        """Kullanıcıdan düşülen toplam."""
        return self.provider + self.platform


def platform_fee() -> int:
    return max(0, int(setting("platform_fee")))


def to_credits(cost_usd: float) -> int:
    """Maliyetin kredi karşılığı (yuvarlanmış, en az MIN_CREDITS)."""
    credit_usd = setting("credit_usd") or DEFAULTS["credit_usd"]
    return max(MIN_CREDITS, math.ceil(round(cost_usd * setting("credit_markup") / credit_usd, 6)))


def unit_credits(variant: Variant) -> int:
    """Seçeneğin birim kredisi: yöneticinin sabitlediği değer, yoksa maliyetten hesaplanan."""
    return variant.credits if variant.credits is not None else to_credits(variant.cost_usd)


def for_tokens(model: ResolvedModel, input_tokens: int, output_tokens: int) -> Price:
    cost = input_tokens * (model.input_usd_per_mtok or 0) / 1_000_000 + output_tokens * (model.output_usd_per_mtok or 0) / 1_000_000
    provider = model.fixed_credits if model.fixed_credits is not None else to_credits(cost)
    return Price(cost_usd=round(cost, 6), provider=provider, platform=platform_fee())


def for_units(variant: Variant | None, units: int) -> Price:
    """Seçeneği olmayan model (ör. katalog okunamadı, .env'e düşüldü) en az ücreti öder."""
    units = max(1, units)
    if variant is None:
        return Price(cost_usd=0.0, provider=MIN_CREDITS, platform=platform_fee())
    return Price(cost_usd=round(variant.cost_usd * units, 6), provider=unit_credits(variant) * units, platform=platform_fee())

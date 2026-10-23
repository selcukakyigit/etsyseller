"""Sağlayıcıdan bağımsız ortak türler: iş mantığı DataForSEO yanıt biçimini bilmez, yalnızca bunları görür."""
from dataclasses import dataclass, field


@dataclass
class MetricRecord:
    term: str  # normalize edilmiş
    search_volume: int | None = None
    cpc: float | None = None
    competition: float | None = None  # 0–1
    difficulty: int | None = None
    intent: str | None = None
    monthly: list[list[int]] | None = None  # [[yıl, ay, hacim], …]


@dataclass
class TrendRecord:
    """Google ilgi endeksi (göreli, 0–100): son 13 haftanın ortalaması ve geçen yılın aynı 13 haftasının ortalaması. Hacim DEĞİL, yön ve büyüklük içindir."""

    term: str
    recent: float | None = None
    previous: float | None = None


@dataclass
class ProviderResponse:
    endpoint: str
    records: list[MetricRecord] = field(default_factory=list)
    cost_usd: float = 0.0
    duration_ms: int = 0
    trends: list[TrendRecord] = field(default_factory=list)


class ProviderError(Exception):
    """`transient` doğruysa iş yeniden denenir (ağ, zaman aşımı, hız sınırı); değilse bir daha denenmez."""

    def __init__(self, message: str, transient: bool = True):
        super().__init__(message)
        self.transient = transient


class ProviderNotConfigured(ProviderError):
    def __init__(self):
        super().__init__("Araştırma sağlayıcısı yapılandırılmamış", transient=False)

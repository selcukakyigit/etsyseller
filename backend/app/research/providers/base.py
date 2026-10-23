"""Araştırma sağlayıcısı sözleşmesi. İş mantığı yalnızca bunu bilir; sağlayıcı değişirse yeni bir adapter yazılır, çağıranlar değişmez.
Sağlayıcı durumsuzdur: kimlik bilgisini çağıran verir (bkz. credentials.py), veritabanına dokunmaz."""
from dataclasses import dataclass
from typing import Protocol

from app.research.records import ProviderResponse


@dataclass(frozen=True)
class Credentials:
    login: str
    password: str


class ResearchProvider(Protocol):
    name: str
    max_volume_terms: int  # tek istekte sorulabilecek en fazla kelime
    max_trend_terms: int  # tek trend isteğinde karşılaştırılabilecek en fazla kelime

    def supports_market(self, market: str) -> bool: ...

    def volumes(self, creds: Credentials, terms: list[str], market: str, language: str) -> ProviderResponse:
        """Verilen kelimelerin aylık arama hacmi / CPC / rekabeti (Google verisi). Veri dönmeyen kelime de kayıt olarak döner."""

    def trends(self, creds: Credentials, terms: list[str], market: str, language: str) -> ProviderResponse:
        """Kelimelerin Google ilgi endeksi: son 13 hafta ile geçen yılın aynı 13 haftası (`ProviderResponse.trends`)."""

    def suggestions(self, creds: Credentials, seed: str, market: str, language: str, limit: int, questions: bool = False) -> ProviderResponse:
        """Tohum kelimeye bağlı uzun kuyruklu adaylar ve metrikleri. `questions`: yalnızca soru kalıplarındaki aramalar (how/what/why…)."""

    def account(self, creds: Credentials) -> dict:
        """Hesap bilgisi (bakiye gibi) — bağlantıyı doğrulamak için; ücretsiz bir çağrıdır."""

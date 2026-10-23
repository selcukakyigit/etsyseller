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

    def supports_market(self, market: str) -> bool: ...

    def volumes(self, creds: Credentials, terms: list[str], market: str, language: str) -> ProviderResponse:
        """Verilen kelimelerin aylık arama hacmi / CPC / rekabeti (Google verisi). Veri dönmeyen kelime de kayıt olarak döner."""

    def suggestions(self, creds: Credentials, seed: str, market: str, language: str, limit: int) -> ProviderResponse:
        """Tohum kelimeye bağlı uzun kuyruklu adaylar ve metrikleri."""

    def account(self, creds: Credentials) -> dict:
        """Hesap bilgisi (bakiye gibi) — bağlantıyı doğrulamak için; ücretsiz bir çağrıdır."""

"""Sağlayıcı kaydı: iş mantığı sağlayıcıyı buradan alır, hangi şirketin kullanıldığını bilmez."""
from app.research.providers.base import ResearchProvider
from app.research.providers.dataforseo import DataForSeoProvider

_PROVIDERS: dict[str, ResearchProvider] = {"dataforseo": DataForSeoProvider()}
DEFAULT_PROVIDER = "dataforseo"


def get_provider(name: str = DEFAULT_PROVIDER) -> ResearchProvider:
    return _PROVIDERS[name]

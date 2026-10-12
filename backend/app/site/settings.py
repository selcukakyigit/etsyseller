"""Tanıtım sitesinin (landing) panelden (Yönetim > Landing) değişen ayarları: alt bilgideki sosyal medya bağlantıları.
Değerler app_settings tablosunda tek anahtar altında JSON olarak durur; boş bağlantı sitede gösterilmez."""
from app.core import app_settings

SOCIAL_KEY = "landing_social"
SOCIAL_NETWORKS = ("instagram", "youtube", "linkedin", "pinterest")


def get_social() -> dict[str, str]:
    stored = app_settings.get(SOCIAL_KEY, {})
    if not isinstance(stored, dict):
        stored = {}
    return {name: str(stored.get(name) or "") for name in SOCIAL_NETWORKS}

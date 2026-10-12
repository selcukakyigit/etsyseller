"""Yönetim > Landing: tanıtım sitesinin ayarları (şimdilik alt bilgideki sosyal medya bağlantıları)."""
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.schemas import LandingSettingsIn, LandingSettingsOut
from app.core import app_settings
from app.site import settings as site_settings


def get_settings() -> LandingSettingsOut:
    return LandingSettingsOut(social=site_settings.get_social())


def update_settings(db: Session, data: LandingSettingsIn) -> LandingSettingsOut:
    social: dict[str, str] = {}
    for name in site_settings.SOCIAL_NETWORKS:
        url = (getattr(data.social, name) or "").strip()
        if url and not url.lower().startswith("https://"):
            raise AdminError(422, f"Bağlantı https:// ile başlamalı: {name}")
        social[name] = url
    app_settings.set_many(db, {site_settings.SOCIAL_KEY: social})
    return get_settings()

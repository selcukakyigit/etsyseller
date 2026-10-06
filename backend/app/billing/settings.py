"""Kredi sisteminin panelden (Yönetim > Krediler) değişen ayarları ve varsayılanları."""
from app.core import app_settings

DEFAULTS = {
    "credits_enabled": False,  # kapalıyken yalnızca ölçülür, düşülmez/engellenmez
    "credit_markup": 3.0,  # sağlayıcı maliyetinin kaç katı kredi olarak alınır
    "credit_usd": 0.01,  # bir kredinin kullanıcıya satış değeri (USD)
    "signup_credits": 0,  # yeni (ya da ilk kez bakiyesi oluşan) çalışma alanına bir kerelik hediye
}


def setting(key: str):
    value = app_settings.get(key, DEFAULTS[key])
    return type(DEFAULTS[key])(value) if value is not None else DEFAULTS[key]


def enabled() -> bool:
    return bool(setting("credits_enabled"))

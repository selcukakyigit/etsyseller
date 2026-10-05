"""Supabase Auth yönetici API'si (gizli anahtarla, yalnızca backend): oturum açmayı engelleme ve şifre sıfırlama jetonu."""
import httpx

from app.core.config import settings

TIMEOUT = 20
# Supabase'de "süresiz" engel yoktur; ~100 yıl.
FOREVER = "876000h"


class SupabaseAdminError(Exception):
    pass


def _base() -> str:
    if not (settings.supabase_url and settings.supabase_secret_key):
        raise SupabaseAdminError("Supabase yapılandırılmamış")
    return f"{settings.supabase_url.rstrip('/')}/auth/v1/admin"


def _headers() -> dict[str, str]:
    return {"apikey": settings.supabase_secret_key, "Authorization": f"Bearer {settings.supabase_secret_key}"}


def set_banned(supabase_id: str, banned: bool) -> None:
    """Engelli kullanıcı giriş yapamaz ve oturumu yenilenemez; mevcut belirteçleri ise backend reddeder (auth/access.py)."""
    try:
        resp = httpx.put(f"{_base()}/users/{supabase_id}", headers=_headers(), json={"ban_duration": FOREVER if banned else "none"}, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise SupabaseAdminError("Kimlik servisine ulaşılamadı") from exc
    if resp.status_code >= 300:
        raise SupabaseAdminError(f"Kimlik servisi hata verdi ({resp.status_code})")


def recovery_token(email: str) -> str:
    """Şifre sıfırlama için tek kullanımlık jeton (hashed_token). E-postayı Supabase değil biz göndeririz: bağlantı
    hangi tarayıcıda açılırsa açılsın çalışır (PKCE akışı yalnızca isteğin yapıldığı tarayıcıda çalışır)."""
    try:
        resp = httpx.post(f"{_base()}/generate_link", headers=_headers(), json={"type": "recovery", "email": email}, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise SupabaseAdminError("Kimlik servisine ulaşılamadı") from exc
    if resp.status_code >= 300:
        raise SupabaseAdminError(f"Kimlik servisi hata verdi ({resp.status_code})")
    data = resp.json()
    token = data.get("hashed_token") or (data.get("properties") or {}).get("hashed_token")
    if not token:
        raise SupabaseAdminError("Kimlik servisi jeton döndürmedi")
    return token

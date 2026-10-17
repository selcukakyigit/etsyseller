import httpx

from app.core.config import settings
from app.etsy import rate_limit
from app.etsy.client import API_BASE, EtsyApiError, _extract_error_message


def _headers() -> dict:
    return {"x-api-key": f"{settings.etsy_api_key}:{settings.etsy_shared_secret}"}


def _get(path: str) -> dict:
    rate_limit.throttle()
    resp = httpx.get(f"{API_BASE}{path}", headers=_headers(), timeout=30)
    if resp.is_error:
        raise EtsyApiError(resp.status_code, _extract_error_message(resp))
    return resp.json()


def get_seller_taxonomy_nodes() -> list[dict]:
    """Taxonomy is shop-independent and doesn't require an OAuth token — just
    the app's own api key, per Etsy's docs. No EtsyClient/shop needed here."""
    return _get("/seller-taxonomy/nodes")["results"]


def get_properties_by_taxonomy_id(taxonomy_id: int) -> list[dict]:
    return _get(f"/seller-taxonomy/nodes/{taxonomy_id}/properties")["results"]


def search_active_listings(keywords: str, limit: int = 50) -> dict:
    """Etsy'nin herkese açık aktif listing araması (uygulamanın kendi API anahtarıyla; mağaza/OAuth gerekmez). Pazar araştırması için:
    başlık, etiket, fiyat, favori ve görüntülenme sayıları. Döner: {"count": toplam sonuç, "results": [...]}."""
    import urllib.parse

    query = urllib.parse.urlencode({"keywords": keywords, "limit": max(1, min(int(limit), 100)), "sort_on": "score"})
    return _get(f"/listings/active?{query}")

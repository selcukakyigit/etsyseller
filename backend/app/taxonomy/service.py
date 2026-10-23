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


def listing_thumbnails(listing_ids: list[int]) -> dict[int, str]:
    """İlanların küçük resim adresleri (ilk görsel, 170x135). Etsy'nin arama uç noktası görsel döndürmediği için toplu uç noktadan tek istekle alınır.
    Resimler yalnızca adres olarak geçer; indirilmez ya da saklanmaz."""
    ids = [int(i) for i in listing_ids if i][:100]
    if not ids:
        return {}
    data = _get(f"/listings/batch?listing_ids={','.join(str(i) for i in ids)}&includes=Images")
    out: dict[int, str] = {}
    for r in data.get("results") or []:
        first = (r.get("images") or [None])[0]
        if first and first.get("url_170x135"):
            out[int(r["listing_id"])] = first["url_170x135"]
    return out


def cached_properties(taxonomy_id: int) -> list[dict]:
    """Bir kategorinin özellik tanımları (bellek → veritabanı → Etsy; düzenleyici, asistan ve toplu işlemler aynı veriyi kullanır, bkz. store.py)."""
    from app.taxonomy import store

    return store.get(f"props:{int(taxonomy_id)}", lambda: get_properties_by_taxonomy_id(int(taxonomy_id)))


def cached_nodes() -> list[dict]:
    """Etsy kategori ağacı (bellek → veritabanı → Etsy)."""
    from app.taxonomy import store

    return store.get("nodes", get_seller_taxonomy_nodes)

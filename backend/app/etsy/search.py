import httpx

from app.core.config import settings
from app.etsy import rate_limit
from app.etsy.client import API_BASE, EtsyApiError, _extract_error_message


def _headers() -> dict:
    return {"x-api-key": f"{settings.etsy_api_key}:{settings.etsy_shared_secret}"}


def find_active_listings(taxonomy_id: int | None = None, keywords: str | None = None, limit: int = 50) -> list[dict]:
    """Public listing search (findAllListingsActive) — like taxonomy, this only
    needs the app's own api key, no shop OAuth token. Used to mine what tags
    top-ranked competitor/category listings are using (Faz D keyword pool).

    Etsy's own docs note that `sort_on=score` "only works when combined with
    one of the search options (keywords, region, etc.)" — taxonomy_id alone
    doesn't count. Without a real keywords term, "top scoring in category X"
    can surface listings that are mis-categorized (sellers cross-listing
    unrelated products under a high-traffic category to farm impressions),
    so pass a keywords term derived from the actual listing whenever possible.
    """
    params: dict = {"limit": min(limit, 100), "sort_on": "score", "sort_order": "desc"}
    if taxonomy_id:
        params["taxonomy_id"] = taxonomy_id
    if keywords:
        params["keywords"] = keywords

    rate_limit.throttle()
    resp = httpx.get(f"{API_BASE}/listings/active", headers=_headers(), params=params, timeout=30)
    if resp.is_error:
        raise EtsyApiError(resp.status_code, _extract_error_message(resp))
    return resp.json()["results"]

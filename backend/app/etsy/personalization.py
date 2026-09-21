import httpx

from app.core.config import settings
from app.etsy import rate_limit
from app.etsy.client import API_BASE, EtsyApiError, EtsyClient, _extract_error_message


def get_personalization(listing_id: int) -> list[dict]:
    """Public — no OAuth token needed, mirrors taxonomy/search's pattern."""
    rate_limit.throttle()
    headers = {"x-api-key": f"{settings.etsy_api_key}:{settings.etsy_shared_secret}"}
    resp = httpx.get(f"{API_BASE}/listings/{listing_id}/personalization", headers=headers, timeout=30)
    if resp.is_error:
        raise EtsyApiError(resp.status_code, _extract_error_message(resp))
    return resp.json().get("personalization_questions", [])


def update_personalization(client: EtsyClient, listing_id: int, questions: list[dict]) -> dict:
    """Fully replaces any existing personalization on the listing — Etsy
    doesn't support a partial update here. `supports_multiple_personalization_questions=true`
    opts into the newer question-type set (text_input/dropdown/upload) rather
    than the legacy single-instructions shape."""
    return client.request(
        "POST",
        f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/personalization",
        params={"supports_multiple_personalization_questions": "true"},
        json={"personalization_questions": questions},
    )


def delete_personalization(client: EtsyClient, listing_id: int) -> None:
    client.request("DELETE", f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/personalization")

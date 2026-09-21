from app.etsy.client import EtsyClient


def list_active_listings(client: EtsyClient, limit: int | None = None) -> list[dict]:
    """Tüm aktif listing'ler (sayfa sayfa). `limit` verilirse ilk N ile sınırlar."""
    results: list[dict] = []
    offset = 0
    while True:
        page = client.request(
            "GET",
            f"/shops/{client.shop.etsy_shop_id}/listings",
            params={"state": "active", "limit": 100, "offset": offset, "includes": "Images,Videos"},
        )
        results.extend(page["results"])
        offset += len(page["results"])
        if offset >= page["count"] or (limit is not None and len(results) >= limit) or not page["results"]:
            break
    return results[:limit] if limit is not None else results


ALL_STATES = ("active", "inactive", "draft", "expired", "sold_out")


def list_listings_by_state(client: EtsyClient, state: str) -> list[dict]:
    """Bir durumdaki tüm listing'ler (sayfa sayfa, görsel ve videolarıyla)."""
    results: list[dict] = []
    offset = 0
    while True:
        page = client.request(
            "GET",
            f"/shops/{client.shop.etsy_shop_id}/listings",
            params={"state": state, "limit": 100, "offset": offset, "includes": "Images,Videos"},
        )
        results.extend(page["results"])
        offset += len(page["results"])
        if offset >= page["count"] or not page["results"]:
            break
    return results


def get_listing(client: EtsyClient, listing_id: int) -> dict:
    return client.request("GET", f"/listings/{listing_id}", params={"includes": "Images,Videos"})


def update_listing(client: EtsyClient, listing_id: int, data: dict) -> dict:
    """Etsy's updateListing expects application/x-www-form-urlencoded, not JSON.
    httpx form-encodes list values (e.g. tags) as repeated fields automatically."""
    return client.request(
        "PATCH", f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}", data=data
    )

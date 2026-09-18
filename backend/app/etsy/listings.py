from app.etsy.client import EtsyClient


def list_active_listings(client: EtsyClient, limit: int = 100) -> list[dict]:
    results: list[dict] = []
    offset = 0
    while True:
        page = client.request(
            "GET",
            f"/shops/{client.shop.etsy_shop_id}/listings",
            params={"state": "active", "limit": min(limit, 100), "offset": offset, "includes": "Images"},
        )
        results.extend(page["results"])
        offset += len(page["results"])
        if offset >= page["count"] or len(results) >= limit or not page["results"]:
            break
    return results[:limit]


def get_listing(client: EtsyClient, listing_id: int) -> dict:
    return client.request("GET", f"/listings/{listing_id}", params={"includes": "Images"})


def update_listing(client: EtsyClient, listing_id: int, data: dict) -> dict:
    """Etsy's updateListing expects application/x-www-form-urlencoded, not JSON.
    httpx form-encodes list values (e.g. tags) as repeated fields automatically."""
    return client.request(
        "PATCH", f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}", data=data
    )

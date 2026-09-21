from app.etsy.client import EtsyClient


def get_variation_images(client: EtsyClient, listing_id: int) -> list[dict]:
    page = client.request(
        "GET", f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/variation-images"
    )
    return page.get("results", [])


def update_variation_images(client: EtsyClient, listing_id: int, items: list[dict]) -> list[dict]:
    """Etsy tüm mevcut varyasyon görsellerini ezer; listede yalnızca tek bir
    property_id olabilir ve (property_id, value_id) çiftleri envanterde bulunmalı."""
    page = client.request(
        "POST",
        f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/variation-images",
        json={"variation_images": items},
    )
    return page.get("results", [])

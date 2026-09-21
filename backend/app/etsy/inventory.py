from app.etsy.client import EtsyClient


def get_inventory(client: EtsyClient, listing_id: int) -> dict:
    return client.request("GET", f"/listings/{listing_id}/inventory")


def _normalize(payload: dict) -> dict:
    """Etsy dokümanı (Listings Tutorial, Note 3): GET cevabından product_id, offering_id,
    scale_name ve is_deleted çıkarılmalı; fiyat Money nesnesi değil, ondalık sayı olmalı."""
    products = []
    for prod in payload.get("products", []):
        prod = {k: v for k, v in prod.items() if k not in ("is_deleted", "product_id")}
        prod["sku"] = prod.get("sku") or ""
        prod["property_values"] = [
            {k: v for k, v in pv.items() if k != "scale_name"} for pv in prod.get("property_values", [])
        ]
        offerings = []
        for off in prod.get("offerings", []):
            off = {k: v for k, v in off.items() if k not in ("is_deleted", "offering_id")}
            price = off.get("price")
            if isinstance(price, dict):
                off["price"] = price["amount"] / price.get("divisor", 100)
            if off.get("readiness_state_id") is None:
                off.pop("readiness_state_id", None)
            offerings.append(off)
        prod["offerings"] = offerings
        products.append(prod)
    return {**payload, "products": products}


def update_inventory(client: EtsyClient, listing_id: int, payload: dict, max_variations_supported: int = 3) -> dict:
    """updateListingInventory takes a JSON body, unlike updateListing/updateListingStatus."""
    return client.request(
        "PUT",
        f"/listings/{listing_id}/inventory",
        json=_normalize(payload),
        params={"max_variations_supported": max_variations_supported},
    )

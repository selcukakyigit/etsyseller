from app.etsy.client import EtsyClient


def list_receipts(client: EtsyClient, limit: int = 100) -> list[dict]:
    results: list[dict] = []
    offset = 0
    while True:
        page = client.request(
            "GET",
            f"/shops/{client.shop.etsy_shop_id}/receipts",
            params={
                "limit": min(limit, 100),
                "offset": offset,
                "sort_on": "created",
                "sort_order": "desc",
            },
        )
        results.extend(page["results"])
        offset += len(page["results"])
        if offset >= page["count"] or len(results) >= limit or not page["results"]:
            break
    return results[:limit]


def update_receipt_status(client: EtsyClient, receipt_id: int, data: dict) -> dict:
    """updateShopReceipt expects application/x-www-form-urlencoded, like updateListing."""
    return client.request(
        "PUT", f"/shops/{client.shop.etsy_shop_id}/receipts/{receipt_id}", data=data
    )


def create_shipment(client: EtsyClient, receipt_id: int, data: dict) -> dict:
    """createReceiptShipment expects a JSON body, unlike most other write endpoints."""
    return client.request(
        "POST", f"/shops/{client.shop.etsy_shop_id}/receipts/{receipt_id}/tracking", json=data
    )

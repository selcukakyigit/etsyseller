from app.etsy.client import EtsyClient


def get_listing_properties(client: EtsyClient, listing_id: int) -> list[dict]:
    page = client.request(
        "GET", f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/properties"
    )
    return page["results"]


def update_listing_property(
    client: EtsyClient,
    listing_id: int,
    property_id: int,
    value_ids: list[int],
    values: list[str],
    scale_id: int | None = None,
) -> dict:
    data: dict = {"value_ids": value_ids, "values": values}
    if scale_id is not None:
        data["scale_id"] = scale_id
    return client.request(
        "PUT",
        f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/properties/{property_id}",
        data=data,
    )


def delete_listing_property(client: EtsyClient, listing_id: int, property_id: int) -> None:
    client.request(
        "DELETE", f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/properties/{property_id}"
    )

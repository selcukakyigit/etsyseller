from app.etsy.client import EtsyClient


def upload_image(
    client: EtsyClient,
    listing_id: int,
    image_bytes: bytes,
    filename: str,
    rank: int | None = None,
    alt_text: str | None = None,
) -> dict:
    data: dict = {}
    if rank is not None:
        data["rank"] = str(rank)
    if alt_text:
        data["alt_text"] = alt_text
    files = {"image": (filename, image_bytes)}
    return client.request(
        "POST",
        f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/images",
        data=data,
        files=files,
    )


def delete_image(client: EtsyClient, listing_id: int, image_id: int) -> None:
    client.request("DELETE", f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/images/{image_id}")


def list_images(client: EtsyClient, listing_id: int) -> list[dict]:
    page = client.request("GET", f"/listings/{listing_id}/images")
    return sorted(page.get("results", []), key=lambda i: i.get("rank", 0))


def reassign_image(client: EtsyClient, listing_id: int, listing_image_id: int, rank: int) -> dict:
    """Silinmiş bir görseli aynı listing_image_id ile, verilen sıraya yeniden bağlar
    (Etsy'de görsel sıralamanın belgelenmiş tek yolu)."""
    return client.request(
        "POST",
        f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/images",
        data={"listing_image_id": str(listing_image_id), "rank": str(rank)},
    )

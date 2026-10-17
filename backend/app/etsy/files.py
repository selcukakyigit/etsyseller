from app.etsy.client import EtsyClient


def upload_listing_file(client: EtsyClient, listing_id: int, content: bytes, filename: str, rank: int = 1) -> dict:
    """Dijital listing'e indirilebilir dosya yükler (Etsy: en fazla 5 dosya, her biri en fazla 20 MB)."""
    return client.request(
        "POST",
        f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/files",
        data={"name": filename, "rank": rank},
        files={"file": (filename, content)},
    )

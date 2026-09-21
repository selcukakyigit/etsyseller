from app.etsy.client import EtsyClient


def upload_video(client: EtsyClient, listing_id: int, video_bytes: bytes, filename: str) -> dict:
    files = {"video": (filename, video_bytes)}
    return client.request(
        "POST",
        f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/videos",
        data={"name": filename},
        files=files,
    )


def delete_video(client: EtsyClient, listing_id: int, video_id: int) -> None:
    client.request("DELETE", f"/shops/{client.shop.etsy_shop_id}/listings/{listing_id}/videos/{video_id}")

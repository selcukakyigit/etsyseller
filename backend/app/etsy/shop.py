from app.etsy.client import EtsyClient


def get_shop(client: EtsyClient) -> dict:
    """Mağaza profili (getShop) — başlık, duyuru, yorum ortalaması/sayısı, favori sayısı, tatil modu, logo vb."""
    return client.request("GET", f"/shops/{client.shop.etsy_shop_id}")


def list_shop_reviews(client: EtsyClient, min_created: int | None = None, limit: int = 100, offset: int = 0) -> dict:
    """Mağaza yorumları (getReviewsByShop). `min_created` verilirse yalnızca o epoch saniyeden sonrakiler
    döner — artımlı senkron için (bkz. jobs/reviews.py), her seferinde tüm geçmişi çekmemek için."""
    params: dict = {"limit": limit, "offset": offset}
    if min_created is not None:
        params["min_created"] = min_created
    return client.request("GET", f"/shops/{client.shop.etsy_shop_id}/reviews", params=params)

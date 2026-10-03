from pydantic import BaseModel


class ShopOut(BaseModel):
    id: int
    etsy_shop_id: int
    shop_name: str
    connected: bool
    is_demo: bool = False
    # Boşsa (None) finans raporu para birimini siparişlerden otomatik seçer (en çok kullanılan); dolu ise mağaza
    # sahibi elle sabitlemiş demektir (`PUT /api/shops/{id}/currency`), her yerde bu kullanılır.
    currency: str | None = None
    icon_url: str | None = None
    # Sıra takibi ülkesi; boşsa otomatik (en çok satılan ülke)
    rank_country: str | None = None

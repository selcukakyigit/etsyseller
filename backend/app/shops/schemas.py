from pydantic import BaseModel


class ShopOut(BaseModel):
    id: int
    etsy_shop_id: int
    shop_name: str
    connected: bool

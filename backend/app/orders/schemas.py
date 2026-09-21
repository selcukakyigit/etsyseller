from pydantic import BaseModel


class OrderItemOut(BaseModel):
    listing_id: int | None
    title: str
    quantity: int


class OrderOut(BaseModel):
    receipt_id: int
    status: str
    buyer_name: str
    total: str  # formatted "12.50 USD" — currency math stays server-side
    is_paid: bool
    is_shipped: bool
    created_at: str
    expected_ship_date: str | None
    items: list[OrderItemOut]
    tracking_codes: list[str]


class ShipRequest(BaseModel):
    tracking_code: str | None = None
    carrier_name: str | None = None


class OrderInsightsOut(BaseModel):
    needs_shipping_today: int
    overdue: int
    top_listing_last_7_days: str | None
    summary: str

from pydantic import BaseModel


class OrderVariationOut(BaseModel):
    name: str
    value: str
    personalization: bool = False


class OrderItemOut(BaseModel):
    listing_id: int | None
    title: str
    quantity: int
    sku: str | None = None
    price: str | None = None
    image_url: str | None = None
    variations: list[OrderVariationOut] = []


class AddressOut(BaseModel):
    name: str = ""
    first_line: str = ""
    second_line: str = ""
    city: str = ""
    state: str = ""
    zip: str = ""
    country_iso: str = ""
    formatted: str = ""


class ShipmentOut(BaseModel):
    carrier: str | None = None
    tracking_code: str | None = None
    notified_at: str | None = None


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
    # Siparişler sayfası (Etsy Shop Manager benzeri) için zengin alanlar
    channel: str = "etsy"  # etsy | pattern
    address: AddressOut = AddressOut()
    buyer_email: str | None = None  # Etsy yalnızca onaylı uygulamalara verir; genelde None
    buyer_note: str | None = None
    is_gift: bool = False
    gift_message: str | None = None
    gift_sender: str | None = None
    coupon: str | None = None
    subtotal: str | None = None
    shipping_cost: str | None = None
    tax: str | None = None
    shipping_method: str | None = None
    shipping_upgrade: str | None = None
    shipments: list[ShipmentOut] = []
    has_personalization: bool = False
    is_canceled: bool = False


class ShipRequest(BaseModel):
    tracking_code: str | None = None
    carrier_name: str | None = None


class OrderInsightsOut(BaseModel):
    needs_shipping_today: int
    overdue: int
    top_listing_last_7_days: str | None
    summary: str


class DestinationCount(BaseModel):
    iso: str
    count: int


class OrderCounts(BaseModel):
    toship: int
    completed: int
    canceled: int
    all: int


class OrdersPageOut(BaseModel):
    items: list[OrderOut]
    total: int  # filtrelere uyan toplam sipariş (sayfalama öncesi)
    counts: OrderCounts  # sekme sayıları (filtresiz)
    destinations: list[DestinationCount]


class OrdersSyncStatus(BaseModel):
    local: int
    remote_total: int | None
    backfilling: bool

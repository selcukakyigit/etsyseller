import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class OrderCache(Base):
    """Local mirror of an Etsy ShopReceipt, refreshed by jobs/order_sync.py
    and on-demand. `raw_json` keeps the full Etsy payload (transactions,
    shipments, buyer message, etc.) so the API layer can read line items
    without adding a column per field Etsy might return."""

    __tablename__ = "order_cache"
    __table_args__ = (UniqueConstraint("shop_id", "receipt_id", name="uq_order_cache_shop_receipt"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    receipt_id: Mapped[int] = mapped_column(Integer, index=True)

    status: Mapped[str] = mapped_column(String(30))
    buyer_name: Mapped[str] = mapped_column(String(255), default="")
    grandtotal_amount: Mapped[int] = mapped_column(Integer, default=0)
    grandtotal_divisor: Mapped[int] = mapped_column(Integer, default=100)
    currency_code: Mapped[str] = mapped_column(String(10), default="USD")

    is_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    is_shipped: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime, index=True)
    expected_ship_date: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    # Filtre/arama/sayfalama için raw_json'dan türetilen sütunlar (bkz. orders/derive.py)
    country_iso: Mapped[str] = mapped_column(String(2), default="", server_default="", index=True)
    channel: Mapped[str] = mapped_column(String(10), default="etsy", server_default="etsy")
    is_gift: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    has_note: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    has_personalization: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    has_upgrade: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    is_canceled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", index=True)
    search_text: Mapped[str] = mapped_column(Text, default="", server_default="")

    raw_json: Mapped[str] = mapped_column(Text)
    synced_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

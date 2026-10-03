import datetime as dt

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Notification(Base):
    """Mağaza olayı bildirimi (şimdilik Etsy webhook'larından gelen sipariş olayları). Metin saklanmaz: `kind` + `data_json`
    tutulur, arayüz iki dilde kurar. Okundu bilgisi mağaza düzeyindedir (aynı mağazaya bakan herkes için ortak).
    Aynı olay tekrar gelirse (Etsy yeniden denemesi, yedek senkron) (shop, kind, receipt) benzersizliği çift kaydı önler."""

    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("shop_id", "kind", "receipt_id", name="uq_notifications_shop_kind_receipt"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))  # order_paid | order_canceled | order_shipped | order_delivered
    receipt_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    data_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)
    read_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)

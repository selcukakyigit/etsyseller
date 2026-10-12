import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import true as sa_true

from app.core.db import MONEY, Base


class CreditBalance(Base):
    """Çalışma alanının kredi bakiyesi: satın alınan, hediye edilen ve yöneticinin eklediği krediler (süresiz); harcama düşer. Her değişiklik
    `CreditLedger`'a da yazılır."""

    __tablename__ = "credit_balances"

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    balance: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class CreditLedger(Base):
    """Kredi hareketi. `credits` işlemin fiyatı (sağlayıcı + platform payı), `delta` bakiyeye gerçekten yansıyan değişiklik: kredi sistemi kapalıyken
    kullanım kaydedilir (maliyet raporu için) ama bakiyeden düşmez, delta 0 olur. `ref` dış olayın kimliğidir (Lemon
    sipariş/fatura no.); benzersizdir, aynı webhook iki kez gelirse kredi iki kez yüklenmez."""

    __tablename__ = "credit_ledger"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(20))  # usage | purchase | grant | adjust | refund
    delta: Mapped[int] = mapped_column(Integer)
    credits: Mapped[int] = mapped_column(Integer)
    platform_credits: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # `credits`in platform payı; kalanı sağlayıcı payı
    task: Mapped[str | None] = mapped_column(String(30), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    variant: Mapped[str | None] = mapped_column(String(40), nullable=True)  # görsel/video seçeneği, ör. "720p"
    cost_usd: Mapped[float | None] = mapped_column(MONEY, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ref: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    note: Mapped[str] = mapped_column(String(300), default="", server_default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)


class BillingProduct(Base):
    """Satılan bir kredi paketi. `variant_id` Lemon Squeezy'deki varyant kimliğidir; fiyatın asıl kaynağı Lemon'dur,
    `price_cents` yalnızca arayüzde gösterim içindir."""

    __tablename__ = "billing_products"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name_tr: Mapped[str] = mapped_column(String(120))
    name_en: Mapped[str] = mapped_column(String(120))
    variant_id: Mapped[str] = mapped_column(String(40), unique=True)
    credits: Mapped[int] = mapped_column(Integer)
    price_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=sa_true())
    sort: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class BillingEvent(Base):
    """Gelen her Lemon Squeezy webhook'u (sorun giderme için). İşlenemeyenler `ok=False` ve hata metniyle kalır."""

    __tablename__ = "billing_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_name: Mapped[str] = mapped_column(String(60))
    lemon_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    workspace_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean)
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)

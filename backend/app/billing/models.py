import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import true as sa_true

from app.core.db import MONEY, Base


class CreditBalance(Base):
    """Çalışma alanının kredi bakiyesi, iki kovada: `plan` aboneliğin her dönem yenilenen kredisi (devretmez), `purchased`
    satın alınan paketler (süresiz). Harcama önce plan kovasından düşer. Her değişiklik `CreditLedger`'a da yazılır."""

    __tablename__ = "credit_balances"

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    plan: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    purchased: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class CreditLedger(Base):
    """Kredi hareketi. `credits` işlemin fiyatı, `delta` bakiyeye gerçekten yansıyan değişiklik: kredi sistemi kapalıyken
    kullanım kaydedilir (maliyet raporu için) ama bakiyeden düşmez, delta 0 olur. `ref` dış olayın kimliğidir (Lemon
    sipariş/fatura no.); benzersizdir, aynı webhook iki kez gelirse kredi iki kez yüklenmez."""

    __tablename__ = "credit_ledger"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(20))  # usage | purchase | plan_reset | grant | adjust | refund
    bucket: Mapped[str] = mapped_column(String(10))  # plan | purchased | mixed (iki kovadan) | none (sistem kapalı)
    delta: Mapped[int] = mapped_column(Integer)
    credits: Mapped[int] = mapped_column(Integer)
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
    """Satılan bir plan (abonelik) ya da kredi paketi. `variant_id` Lemon Squeezy'deki varyant kimliğidir; fiyatın asıl
    kaynağı Lemon'dur, `price_cents` yalnızca arayüzde gösterim içindir."""

    __tablename__ = "billing_products"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(10))  # plan | pack
    name_tr: Mapped[str] = mapped_column(String(120))
    name_en: Mapped[str] = mapped_column(String(120))
    variant_id: Mapped[str] = mapped_column(String(40), unique=True)
    credits: Mapped[int] = mapped_column(Integer)  # plan: dönem başına; paket: bir kerelik
    price_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")
    interval: Mapped[str | None] = mapped_column(String(10), nullable=True)  # plan: month | year
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=sa_true())
    sort: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class Subscription(Base):
    """Lemon Squeezy aboneliğinin yerel kopyası (webhook'larla güncellenir)."""

    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    lemon_subscription_id: Mapped[str] = mapped_column(String(40), unique=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("billing_products.id", ondelete="SET NULL"), nullable=True)
    variant_id: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30))  # on_trial | active | paused | past_due | unpaid | cancelled | expired
    renews_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    portal_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


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

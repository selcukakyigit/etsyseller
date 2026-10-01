import datetime as dt

from sqlalchemy import Date, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class LedgerEntry(Base):
    """Etsy Payment Account ledger satırı (ücret, vergi, ödeme, reklam, aktarım…). Tutarlar ledger para biriminin
    küçük birimindedir (çoğu hesapta TRY kuruş); mağaza para birimine çevirme finance/service.py'de yapılır."""

    __tablename__ = "ledger_entries"
    __table_args__ = (UniqueConstraint("shop_id", "entry_id", name="uq_ledger_shop_entry"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    entry_id: Mapped[int] = mapped_column(Integer)
    created_ts: Mapped[int] = mapped_column(Integer, index=True)
    amount: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(10), default="")
    ledger_type: Mapped[str] = mapped_column(String(60), index=True)
    reference_type: Mapped[str] = mapped_column(String(40), default="")
    reference_id: Mapped[str] = mapped_column(String(40), default="")
    receipt_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)


class FinPayment(Base):
    """Ödeme -> sipariş eşlemesi ve kur (ödeme brüt tutarı / sipariş genel toplamı)."""

    __tablename__ = "fin_payments"
    __table_args__ = (UniqueConstraint("shop_id", "payment_id", name="uq_finpay_shop_payment"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    payment_id: Mapped[int] = mapped_column(Integer)
    receipt_id: Mapped[int] = mapped_column(Integer, index=True)
    gross_minor: Mapped[int] = mapped_column(Integer, default=0)
    fees_minor: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(10), default="")


class ListingCost(Base):
    """Kullanıcının girdiği birim maliyet ve kargo maliyeti (mağaza para biriminde, ürün adedi başına)."""

    __tablename__ = "listing_costs"
    __table_args__ = (UniqueConstraint("shop_id", "listing_id", name="uq_listing_cost"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(Integer)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    shipping_cost: Mapped[float] = mapped_column(Float, default=0.0)
    cost_pct: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")  # satış fiyatının yüzdesi
    updated_at: Mapped[dt.datetime] = mapped_column(default=dt.datetime.utcnow)


class VariantCost(Base):
    """Listing içindeki bir seçenek (ör. boyut 12" x 24") için maliyet; yoksa listing maliyeti kullanılır."""

    __tablename__ = "variant_costs"
    __table_args__ = (UniqueConstraint("shop_id", "listing_id", "variant_key", name="uq_variant_cost"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(Integer)
    variant_key: Mapped[str] = mapped_column(String(300))
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    shipping_cost: Mapped[float] = mapped_column(Float, default=0.0)
    cost_pct: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")


class OrderCost(Base):
    """Tek bir sipariş için elle girilmiş toplam maliyet (özel siparişler); otomatik hesabın yerine geçer."""

    __tablename__ = "order_costs"
    __table_args__ = (UniqueConstraint("shop_id", "receipt_id", name="uq_order_cost"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    receipt_id: Mapped[int] = mapped_column(Integer)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    note: Mapped[str] = mapped_column(String(255), default="")


class ShippingInvoice(Base):
    """Bir kargo/gümrük faturasından yapay zekâyla çıkarılan TEK bir tutar satırı. Dosyanın kendisi hiç
    saklanmaz — yalnızca çıkarılan sayısal veri. Bir gönderi birden fazla fatura alabilir (ör. FedEx gümrük +
    nakliye ayrı ayrı); bir varyantın toplam fatura-kaynaklı kargo maliyeti bu tablodaki ilgili satırların
    toplamıdır (bkz. app/finance/invoices.py -> invoice_totals)."""

    __tablename__ = "shipping_invoices"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    receipt_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)  # eşleşen Etsy siparişi
    tracking_no: Mapped[str] = mapped_column(String(40), default="", index=True)  # aynı gönderi iki kez girilmesin
    listing_id: Mapped[int] = mapped_column(Integer, index=True)
    variant_key: Mapped[str] = mapped_column(String(300), default="")
    kind: Mapped[str] = mapped_column(String(20), default="diğer")  # "nakliye" | "gümrük" | "ek hizmet" | "diğer"
    description: Mapped[str] = mapped_column(String(200), default="")  # faturadaki kalem adı ("Hizmet Ücreti", "Gümrük Vergisi"…)
    invoice_no: Mapped[str] = mapped_column(String(60), default="")
    # Aynı kalemin (fatura no + gönderi + tür + tutar) iki kez girilmesini önler; bir kalem birden fazla ürüne
    # dağıtıldığı için birden fazla satır aynı parmak izini taşır.
    fingerprint: Mapped[str] = mapped_column(String(200), default="", index=True)
    amount: Mapped[float] = mapped_column(Float)  # rapor para biriminde (report currency)
    original_amount: Mapped[float] = mapped_column(Float)
    original_currency: Mapped[str] = mapped_column(String(10), default="")
    fx_rate: Mapped[float] = mapped_column(Float, default=1.0)
    fx_source: Mapped[str] = mapped_column(String(20), default="fatura")  # "fatura" | "tarih" | "aynı"
    invoice_date: Mapped[dt.date] = mapped_column(Date)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    vendor: Mapped[str] = mapped_column(String(120), default="")
    source_filename: Mapped[str] = mapped_column(String(255), default="")
    match_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[dt.datetime] = mapped_column(default=dt.datetime.utcnow)

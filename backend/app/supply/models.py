"""Dış Tedarik tabloları. İş, tedarikçi kaydına (module_entities) bağlıdır; tedarikçi silinince işleri, satırları ve
dağıtımları zincirleme silinir. Dağıtım satırı mağazaya da bağlıdır: mağaza silinince o mağazaya düşen pay gider."""
import datetime as dt

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import FX, MONEY, PCT, Base
from app.modkit.models import EntityOwned, Timestamped

JOB_STATUSES = ("draft", "submitted", "confirmed", "disputed")


class SupplyJob(EntityOwned, Timestamped, Base):
    """Tedarikçiye yaptırılan bir iş / teslimat. `estimate` fiyat listesinden hesaplanır (KDV hariç); `actual`
    tedarikçinin istediği tutardır (KDV hariç, girildiyse maliyet budur). Onaylanınca `allocation_plan`
    `supply_allocations` satırlarına dönüşür ve finans raporlarına girer; yeniden açılınca o satırlar silinir."""

    __tablename__ = "supply_jobs"
    __table_args__ = (UniqueConstraint("entity_id", "number", name="uq_supply_jobs_entity_number"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200), default="")
    job_date: Mapped[dt.date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(12), default="draft")
    currency: Mapped[str] = mapped_column(String(3))
    vat_rate: Mapped[float] = mapped_column(PCT, default=0.0)
    estimate: Mapped[float] = mapped_column(MONEY, default=0.0)
    actual: Mapped[float | None] = mapped_column(MONEY, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    # Kesimcinin süre (lazer) bedeli: elle yazılırsa o, boşsa süre ölçüsüne eşlenmiş tahmin satırlarının toplamı. Malzeme tahmini
    # yalnızca `with_material` ise paya girer (malzeme bazen kesimciden değil müşteriden gelir).
    time_fee: Mapped[float | None] = mapped_column(MONEY, nullable=True)
    # Onay anında ürünlerin kullandığı malzemenin tahmini: raporlarda işin maliyetini malzeme / hizmet / sabit ücret diye bölmek için.
    material_cost: Mapped[float | None] = mapped_column(MONEY, nullable=True)
    with_material: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    dispute_note: Mapped[str] = mapped_column(String(500), default="")
    allocation_plan: Mapped[str] = mapped_column(Text, default="[]")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_via: Mapped[str] = mapped_column(String(8), default="owner")  # owner | guest
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    confirmed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class SupplyJobDocument(Base):
    """İşe bağlı okunmuş belge. Bir işte birden çok belge olabilir (ör. her plakanın raporu); işin ölçüleri ve satırları hepsinin toplamıdır
    (`profile.merge`). Belge silinince bağ da gider."""

    __tablename__ = "supply_job_documents"
    __table_args__ = (UniqueConstraint("job_id", "document_id", name="uq_supply_job_documents_job_document"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("supply_jobs.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("entity_documents.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class SupplyJobLine(Base):
    """İş satırı. Fiyat listesine bağlıysa `unit_price` işin tarihindeki fiyatın anlık kopyasıdır (fiyat sonradan
    değişse de satır değişmez). `manual_price`: fiyat elle girildi (belgede yazan tutar ya da listede olmayan kalem)."""

    __tablename__ = "supply_job_lines"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("supply_jobs.id", ondelete="CASCADE"), index=True)
    price_item_id: Mapped[int | None] = mapped_column(ForeignKey("price_items.id", ondelete="SET NULL"), nullable=True, index=True)
    description: Mapped[str] = mapped_column(String(200), default="")
    qty: Mapped[float] = mapped_column(Numeric(18, 6, asdecimal=False), default=1.0)
    unit: Mapped[str] = mapped_column(String(10), default="piece")
    unit_price: Mapped[float] = mapped_column(MONEY, default=0.0)
    manual_price: Mapped[bool] = mapped_column(Boolean, default=False)
    amount: Mapped[float] = mapped_column(MONEY, default=0.0)
    source_key: Mapped[str] = mapped_column(String(120), default="")  # belgeden geldiyse alan anahtarı
    position: Mapped[int] = mapped_column(Integer, default=0)


class SupplyAllocation(Base):
    """Onaylanmış bir işin maliyetinden bir mağazaya düşen pay: bir ürüne (listing_id) ya da genel gidere (None); `party_id` doluysa
    mağazalara yazılmayan dış paydır (başka hesap, yerel satış…): maliyete ve Finans'a girmez, yalnızca raporda görünür.
    `amount` iş para biriminde, `amount_report` mağazanın rapor para biriminde (onay anındaki kurla)."""

    __tablename__ = "supply_allocations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("supply_jobs.id", ondelete="CASCADE"), index=True)
    shop_id: Mapped[int | None] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True, nullable=True)  # dış payda boş
    party_id: Mapped[int | None] = mapped_column(ForeignKey("external_parties.id", ondelete="RESTRICT"), index=True, nullable=True)  # yalnızca dış pay
    listing_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    variant: Mapped[str] = mapped_column(String(300), default="")  # listing içindeki seçenek; "" = tüm ürün
    title: Mapped[str] = mapped_column(String(200), default="")
    qty: Mapped[int] = mapped_column(Integer, default=1)
    amount: Mapped[float] = mapped_column(MONEY)
    amount_report: Mapped[float] = mapped_column(MONEY)
    report_ccy: Mapped[str] = mapped_column(String(10))
    fx_rate: Mapped[float] = mapped_column(FX, default=1.0)
    applied_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)  # ürün maliyetine yazıldıysa
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class PackageType(EntityOwned, Base):
    """Ambalaj tarifi ("Ahşap çerçeve", "Palet", "Kutu"…): bir tedarikçi kaydına bağlı, satırlardan oluşur. Her satır, o tedarikçinin fiyat
    listesindeki bir kalemin miktarını ürün ebadından hesaplar. `is_default`: ürüne özel seçim yapılmamışsa her ürüne uygulanır."""

    __tablename__ = "supply_package_types"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    position: Mapped[int] = mapped_column(Integer, default=0)


class PackageLine(Base):
    """Paket türünün bir satırı. Miktar = sabit + a × uzun kenar + b × kısa kenar + c × alan; değişkenler metre ve m² (sonuç kalemin biriminde:
    uzunluk kalemi metre, alan kalemi m², adet kalemi sayı)."""

    __tablename__ = "supply_package_lines"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    package_id: Mapped[int] = mapped_column(ForeignKey("supply_package_types.id", ondelete="CASCADE"), index=True)
    price_item_id: Mapped[int] = mapped_column(ForeignKey("price_items.id", ondelete="CASCADE"), index=True)
    constant: Mapped[float] = mapped_column(Numeric(14, 4, asdecimal=False), default=0.0)
    per_long: Mapped[float] = mapped_column(Numeric(14, 4, asdecimal=False), default=0.0)
    per_short: Mapped[float] = mapped_column(Numeric(14, 4, asdecimal=False), default=0.0)
    per_area: Mapped[float] = mapped_column(Numeric(14, 4, asdecimal=False), default=0.0)
    position: Mapped[int] = mapped_column(Integer, default=0)


class ProductPackage(Base):
    """Ürüne (çalışma alanı seviyesinde ortak: mağaza + listing + seçenek) atanmış paket türü. `package_id` boşsa ürün "ambalajsız"dır
    (varsayılan paket türleri uygulanmaz)."""

    __tablename__ = "supply_product_packages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger)
    variant: Mapped[str] = mapped_column(String(300), default="")
    package_id: Mapped[int | None] = mapped_column(ForeignKey("supply_package_types.id", ondelete="CASCADE"), nullable=True, index=True)


class ProductPaint(EntityOwned, Base):
    """Ürünün bu boyacıdaki boya türü: boyacının fiyat listesindeki m² kalemi ("texture black", "gold"…). İş dağıtımında seçilir, sonraki işlerde
    aynı ürüne kendiliğinden gelir."""

    __tablename__ = "supply_product_paints"
    __table_args__ = (UniqueConstraint("entity_id", "shop_id", "listing_id", "variant", name="uq_supply_product_paints_target"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"))
    listing_id: Mapped[int] = mapped_column(BigInteger)
    variant: Mapped[str] = mapped_column(String(300), default="")
    price_item_id: Mapped[int] = mapped_column(ForeignKey("price_items.id", ondelete="CASCADE"), index=True)

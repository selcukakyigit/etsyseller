"""Modül çekirdeğinin tabloları. Hepsi `module_entities` satırına yabancı anahtarla bağlıdır (ON DELETE CASCADE):
bir kayıt silinince fiyatları, belgeleri, davetleri, erişimleri ve akışı veritabanında birlikte silinir. Kullanıcıya
giden bağlar (kim ekledi, kim değiştirdi) kullanıcı silinince boşa düşer (SET NULL) — kayıt geçmişi bozulmaz."""
import datetime as dt

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from app.core.db import MONEY, PCT, Base


def _now() -> dt.datetime:
    return dt.datetime.utcnow()


class Timestamped:
    """created_at / updated_at — her değişiklikte updated_at kendiliğinden yenilenir."""

    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class EntityOwned:
    """Bir modül kaydına ait satır. Kayıt silinince satır da silinir."""

    @declared_attr
    def entity_id(cls) -> Mapped[int]:  # noqa: N805
        return mapped_column(ForeignKey("module_entities.id", ondelete="CASCADE"), index=True)


def _user_fk(nullable: bool = True):
    return mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=nullable)


class ModuleEntity(Timestamped, Base):
    """Bir modülün içindeki kayıt: Dış Tedarik'te bir tedarikçi ("ABC Lazer"). Adı ve etiketi kullanıcı belirler;
    Ulagg sektör bilmez. `module` kaydın hangi modüle ait olduğunu söyler ("supply")."""

    __tablename__ = "module_entities"
    __table_args__ = (Index("ix_module_entities_ws_module", "workspace_id", "module"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    module: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(120))
    label: Mapped[str] = mapped_column(String(60), default="")  # serbest etiket: "Kesimci", "Fırın"…
    currency: Mapped[str] = mapped_column(String(3), default="TRY")
    vat_rate: Mapped[float] = mapped_column(PCT, default=0.0)  # yüzde (20 = %20)
    vat_in_cost: Mapped[bool] = mapped_column(Boolean, default=False)  # KDV maliyete eklensin mi (indirilemiyorsa)
    contact_email: Mapped[str] = mapped_column(String(255), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    image_path: Mapped[str] = mapped_column(String(500), default="")  # logo / profil resmi (kalıcı depoda, kare WEBP)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = _user_fk()


class PriceItem(EntityOwned, Base):
    """Fiyat listesi kalemi. `kind`: service (hizmet: kesim, fırınlama…), material (hammadde), fee (her işe bir kez
    eklenen sabit ücret: hazırlık), minimum (iş toplamının alt sınırı). Fiyat ayrı tabloda sürümlüdür."""

    __tablename__ = "price_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(12))
    name: Mapped[str] = mapped_column(String(120))
    unit: Mapped[str] = mapped_column(String(10))
    spec: Mapped[str] = mapped_column(String(200), default="")  # serbest açıklama: "2 mm, DKP, 1500×3000"
    # Tüketim kuralı: doluysa kalem her yeni işe bu miktarla kendiliğinden eklenir (ör. "strech: her işe 0,5 kg").
    auto_qty: Mapped[float | None] = mapped_column(Numeric(18, 6, asdecimal=False), nullable=True)
    # Yalnızca malzeme kalemleri: tür (yoğunluk bundan), kalınlık ve isteğe bağlı plaka boyutu / ağırlığı. Ürünün malzeme
    # maliyeti bunlardan hesaplanır (bkz. materials.stock_cost); boşsa kalem adı ve açıklamasından okunur (eski kalemler).
    material: Mapped[str | None] = mapped_column(String(20), nullable=True)
    thickness_mm: Mapped[float | None] = mapped_column(Numeric(10, 3, asdecimal=False), nullable=True)
    plate_width: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=True)
    plate_height: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=True)
    plate_kg: Mapped[float | None] = mapped_column(Numeric(12, 3, asdecimal=False), nullable=True)
    # Sarf (streç, bant…): rulo eni (mm), film kalınlığı (mikron) ve rulo boyu (m); kg/adet fiyatı metreye çevirmek için (bkz. materials.per_metre).
    roll_width: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=True)
    film_um: Mapped[float | None] = mapped_column(Numeric(10, 3, asdecimal=False), nullable=True)
    roll_length: Mapped[float | None] = mapped_column(Numeric(12, 3, asdecimal=False), nullable=True)
    # Stok takibi (yalnızca malzeme kalemleri; bkz. stock.py): miktar `stock_movements` defterinin toplamıdır, burada tutulmaz.
    # `pack_size`: bir paketteki miktar (kalemin biriminde; strafor paketi 20 adet, streç rulosu 2 kg) — alım girerken "30 paket" yazılabilsin diye.
    # Yüzdelik sabit ücret (`kind` fee, `unit` "pct"): fiyat sürümleri yüzde değerini tutar; ücret = işin hizmet/malzeme satırları toplamının yüzdesi,
    # `min_amount`'tan küçükse o (bkz. pricing.percent_fee).
    min_amount: Mapped[float | None] = mapped_column(Numeric(14, 4, asdecimal=False), nullable=True)
    track_stock: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    min_stock: Mapped[float | None] = mapped_column(Numeric(18, 6, asdecimal=False), nullable=True)
    pack_size: Mapped[float | None] = mapped_column(Numeric(18, 6, asdecimal=False), nullable=True)
    # Alış paketinin türü (bkz. packs.py: paket, rulo, koli…); `pack_size` bu paketteki miktardır. Fiyat paket başına girilebilir.
    pack_unit: Mapped[str | None] = mapped_column(String(12), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class StockMovement(EntityOwned, Base):
    """Stok hareketi: bir malzeme kaleminin miktarını kalemin BİRİMİNDE değiştirir (`qty` işaretli: alım +, kullanım −). Stok = hareketlerin toplamı.
    `kind`: opening (açılış), purchase (alım), use (iş kullanımı; `ref_type`/`ref_id` o işe bağlar, iş yeniden açılınca silinir), adjust (sayım düzeltmesi).
    `unit_cost`: kalemin birimi başına maliyet — alımda ödenen (KDV maliyete dahil edilmeye göre), çıkışta o anki ağırlıklı ortalama (anlık kopya)."""

    __tablename__ = "stock_movements"
    __table_args__ = (Index("ix_stock_movements_item_moved", "item_id", "moved_on", "id"), Index("ix_stock_movements_ref", "ref_type", "ref_id"))

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("price_items.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(10))
    qty: Mapped[float] = mapped_column(Numeric(18, 6, asdecimal=False))
    unit_cost: Mapped[float | None] = mapped_column(Numeric(18, 6, asdecimal=False), nullable=True)
    moved_on: Mapped[dt.date] = mapped_column(Date)
    ref_type: Mapped[str] = mapped_column(String(12), default="", server_default="")
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str] = mapped_column(String(200), default="", server_default="")
    created_by: Mapped[int | None] = _user_fk()
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class MaterialType(Base):
    """Kullanıcının eklediği malzeme türü (yerleşik türler kodda: `materials.MATERIALS`). ÇALIŞMA ALANI seviyesindedir; bütün modüllerde ve ürün
    malzemesinde seçilebilir. Anahtarı "c<id>"dir. `group`: davranış grubu (`materials.GROUPS`); `density` yalnızca levha grubunda (g/cm³).
    Değişmez: yalnızca eklenir ya da silinir (silinince kalemleri "Diğer"e taşınır)."""

    __tablename__ = "material_types"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_material_types_workspace_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    group: Mapped[str] = mapped_column(String(8))
    density: Mapped[float | None] = mapped_column(Numeric(8, 3, asdecimal=False), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class PriceVersion(Base):
    """Bir kalemin `valid_from` anından itibaren geçerli fiyatı. Fiyat değişince satır güncellenmez, yenisi eklenir:
    geçmiş tarihli bir iş, o tarihte geçerli fiyatla hesaplanır."""

    __tablename__ = "price_versions"
    __table_args__ = (Index("ix_price_versions_item_from", "item_id", "valid_from"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("price_items.id", ondelete="CASCADE"))
    price: Mapped[float] = mapped_column(MONEY)
    valid_from: Mapped[dt.datetime] = mapped_column(DateTime)
    source: Mapped[str] = mapped_column(String(8), default="owner")  # owner | guest (tedarikçinin kendisi)
    created_by: Mapped[int | None] = _user_fk()
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class EntityDocument(EntityOwned, Base):
    """Kayda yüklenmiş belge (PDF, fotoğraf, Excel…). Dosya kalıcı depoda; çıkarılan veri burada."""

    __tablename__ = "entity_documents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    uploaded_by: Mapped[int | None] = _user_fk()
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    path: Mapped[str] = mapped_column(String(500), default="")  # yapıştırılan metinde boş
    profile: Mapped[str] = mapped_column(String(40))
    extracted_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    extract_source: Mapped[str] = mapped_column(String(12), default="")  # cache | rule | table | text | vision
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now, index=True)


class AnalyzerCache(Base):
    """Aynı içerik (SHA-256) aynı profille ikinci kez okunursa yapay zekâ çağrılmaz. Çalışma alanı başına tutulur:
    bir müşterinin belgesinden çıkan veri başka müşteriye asla dönmez."""

    __tablename__ = "analyzer_cache"
    __table_args__ = (UniqueConstraint("workspace_id", "profile", "sha256", name="uq_analyzer_cache_ws_profile_sha"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    profile: Mapped[str] = mapped_column(String(40))
    sha256: Mapped[str] = mapped_column(String(64))
    result_json: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(12))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class FieldMapping(EntityOwned, Base):
    """Belgeden okunan bir alanın ("Planned Process Time") hangi fiyat kalemine ("Lazer kesim, dk") karşılık geldiği.
    Bir kez öğretilir; aynı kaydın sonraki belgeleri otomatik fiyatlanır."""

    __tablename__ = "field_mappings"
    __table_args__ = (UniqueConstraint("entity_id", "profile", "field_key", name="uq_field_mappings_entity_profile_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    profile: Mapped[str] = mapped_column(String(40))
    field_key: Mapped[str] = mapped_column(String(120))
    price_item_id: Mapped[int] = mapped_column(ForeignKey("price_items.id", ondelete="CASCADE"))


class ExternalParty(Base):
    """Maliyetin kendi mağazalarına yazılmayan payının sahibi: başka bir Ulagg hesabındaki mağaza, yerel (liste dışı) satış, ortak vb.
    ÇALIŞMA ALANI seviyesindedir ve bütün modüllerce kullanılır. Pay maliyete/Finans'a yazılmaz; yalnızca kimin ne kadar payı olduğu
    kayıt ve rapor için tutulur. Kullanılmış bir kayıt silinmez, arşive alınır."""

    __tablename__ = "external_parties"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_external_parties_workspace_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class ProductMeasure(Base):
    """Bir mağaza ürününün (listing + seçenek + parça) üretim tanımı: kesim uzunluğu, delme sayısı, ebat, yüzey alanı, boyalı yüz sayısı,
    malzeme türü ve kalınlığı… ÇALIŞMA ALANI seviyesindedir: ürün bir kez tanımlanır, bütün modül kayıtları (tedarikçiler) kullanır;
    tedarikçiye özel olan yalnızca fiyattır (malzeme türü + kalınlık, tedarikçinin fiyat listesindeki kalemle eşleşir).
    Anahtar/değer olduğu için her modül kendi ölçüsünü ekleyebilir (bkz. products.MEASURES). Malzeme türü sayı değil metindir
    (`text`, anahtar "material"). Mağaza silinince ölçüleri de gider. `source`: elle girildi mi (manual) yoksa çizimden mi (cad)."""

    __tablename__ = "product_measures"
    __table_args__ = (UniqueConstraint("workspace_id", "shop_id", "listing_id", "variant", "part", "key", name="uq_product_measures_target_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger)
    variant: Mapped[str] = mapped_column(String(300), default="")  # listing içindeki seçenek (ör. ebat); "" = tüm ürün
    # Ürünün parçası: bir ürün birden çok parçadan (farklı ebat ve malzeme) oluşabilir; her parçanın kendi ölçüleri ve malzemesi vardır,
    # ürünün kesim uzunluğu parçaların toplamı, malzeme maliyeti parçaların malzemelerinin toplamıdır.
    part: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    key: Mapped[str] = mapped_column(String(30))
    value: Mapped[float] = mapped_column(Numeric(18, 4, asdecimal=False))  # malzeme satırında 0
    text: Mapped[str] = mapped_column(String(20), default="", server_default="")  # yalnızca malzeme: tür anahtarı (materials.MATERIALS)
    source: Mapped[str] = mapped_column(String(8), default="manual")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class ShareInvite(EntityOwned, Base):
    """E-posta daveti. Belirtecin kendisi saklanmaz, yalnızca SHA-256 özeti: veritabanı sızsa bile davet kullanılamaz.
    Tek kullanımlık, süreli, geri alınabilir; yalnızca davet edilen e-postayla giriş yapan hesap kabul edebilir."""

    __tablename__ = "share_invites"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    permissions: Mapped[str] = mapped_column(String(200), default="")
    invited_by: Mapped[int | None] = _user_fk()
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime)
    accepted_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    accepted_by: Mapped[int | None] = _user_fk()
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    last_sent_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    send_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class ShareGrant(EntityOwned, Timestamped, Base):
    """Kabul edilmiş davet: bir kullanıcının (çalışma alanı üyesi olmadan) tek bir kayda erişimi. Mağazaları, siparişleri
    ve finansı göremez; yalnızca bu kaydın izin verilen bölümlerini."""

    __tablename__ = "share_grants"
    __table_args__ = (UniqueConstraint("entity_id", "user_id", name="uq_share_grants_entity_user"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    permissions: Mapped[str] = mapped_column(String(200), default="")
    granted_by: Mapped[int | None] = _user_fk()


class EntityActivity(EntityOwned, Base):
    """Kayıt üzerindeki olaylar: fiyat değişti, iş eklendi, onaylandı, davet kabul edildi… Metin değil `kind` +
    `data_json` saklanır (arayüz iki dilde kurar). `internal` olaylar (ürün dağıtımı gibi) misafire gösterilmez."""

    __tablename__ = "entity_activity"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    actor_id: Mapped[int | None] = _user_fk()
    kind: Mapped[str] = mapped_column(String(40))
    data_json: Mapped[str] = mapped_column(Text, default="{}")
    internal: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now, index=True)

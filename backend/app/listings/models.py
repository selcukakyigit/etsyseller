import datetime as dt

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ListingCache(Base):
    """Local mirror of an Etsy listing (details + inventory + properties),
    refreshed only by an explicit sync (see listings/service.py sync_listings)
    — not on every page view. Etsy's per-second rate limit is shared across
    the whole app; re-fetching live on every navigation (list view + edit
    view alone fire 5 requests) trips it easily. `raw_json`/`inventory_json`/
    `properties_json` keep the full Etsy payloads so the API layer doesn't
    need a column per field Etsy might return."""

    __tablename__ = "listing_cache"
    __table_args__ = (UniqueConstraint("shop_id", "listing_id", name="uq_listing_cache_shop_listing"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)

    title: Mapped[str] = mapped_column(Text, default="")
    views: Mapped[int] = mapped_column(Integer, default=0)
    favorites: Mapped[int] = mapped_column(Integer, default=0)

    raw_json: Mapped[str] = mapped_column(Text)
    inventory_json: Mapped[str] = mapped_column(Text, default="{}")
    properties_json: Mapped[str] = mapped_column(Text, default="[]")
    variation_images_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    personalization_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    # False = varyasyon görselleri/kişiselleştirme henüz Etsy'den alınmadı (eski önbellek satırı)
    extras_synced: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    synced_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class ListingVersion(Base):
    """Yapay zekâ önerilerinin günlüğü (her "AI önerisi" bir satır; geri alınırsa `status="dismissed"`). Yayının
    AI destekli olup olmadığı buradan anlaşılır (bkz. listings/changes.py). Etsy'ye giden değişikliklerin kaydı
    ListingChange'tir; eski sürümlerde `kind="manual_edit"` ve `status="applied"` satırlar da yazılırdı (0017'de taşındı)."""

    __tablename__ = "listing_versions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)

    kind: Mapped[str] = mapped_column(String(20), default="ai_suggestion")  # ai_suggestion|manual_edit

    original_title: Mapped[str] = mapped_column(Text)
    original_tags: Mapped[str] = mapped_column(Text)  # JSON-encoded list
    original_description: Mapped[str] = mapped_column(Text)

    suggested_title: Mapped[str] = mapped_column(Text)
    suggested_tags: Mapped[str] = mapped_column(Text)  # JSON-encoded list
    suggested_description: Mapped[str] = mapped_column(Text)
    rationale: Mapped[str] = mapped_column(Text, default="")

    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|applied|dismissed
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    applied_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class ListingChange(Base):
    """Etsy'ye giden bir değişiklik: Ulagg'dan yayın (`source` = ai | manual) ya da Etsy'de yapılıp günlük kayıtta
    yakalanan metin değişikliği (`source` = etsy). "Değiştir → bekle → ölç" döngüsünün omurgası: sağlık değerlendirmesi
    yeni gözlem penceresini, teşhis olayları, ölçüm (insights/impact.py) önce/sonra karşılaştırmasını buradan alır.

    `fields`: değişen alanlar (title, tags, description, materials, images, videos, price, inventory, properties,
    personalization, shipping, other). `details`: kısa özet (eski/yeni başlık, eklenen/çıkan etiketler, fiyat, fotoğraf
    sayısı). `focus`: yayın anındaki teşhisin önerdiği odak (seo | appeal | conversion | shop | demand | track | keep | wait).
    `result_json`: son ölçüm (günlük iş yazar; 30 günlük ölçüm tamamlanınca `final` olur ve bir daha hesaplanmaz)."""

    __tablename__ = "listing_changes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)
    published_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)
    source: Mapped[str] = mapped_column(String(10), default="manual")
    fields: Mapped[str] = mapped_column(Text, default="[]")  # JSON liste
    details: Mapped[str] = mapped_column(Text, default="{}")  # JSON
    focus: Mapped[str | None] = mapped_column(String(20), nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    measured_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class ListingStatSnapshot(Base):
    """Günlük görüntülenme/favori kaydı (jobs/daily_stats.py). Etsy yalnızca ömür boyu toplamı verdiği için dönem
    değerleri bu kayıtların farkından hesaplanır; değişikliklerin etkisi de buna göre ölçülür (insights/impact.py)."""

    __tablename__ = "listing_stat_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)
    views: Mapped[int] = mapped_column(Integer, default=0)
    favorites: Mapped[int] = mapped_column(Integer, default=0)
    captured_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)
    # Başlık+etiket+açıklamanın kısa parmak izi; değişince içeriğin o gün güncellendiği anlaşılır (bkz. listings/performance.py)
    content_hash: Mapped[str | None] = mapped_column(String(16), nullable=True)


class ListingDraft(Base):
    """Yerel taslak: bir listing'in düzenlenmiş çalışma kopyasının tamamı (JSON).
    Etsy'ye yalnızca "Yayınla" ile gider; taslakta yapılan hiçbir değişiklik
    Etsy'yi etkilemez. Yayın, taslağı canlı Etsy durumuyla karşılaştırıp farkı uygular."""

    __tablename__ = "listing_drafts"
    __table_args__ = (UniqueConstraint("shop_id", "listing_id", name="uq_listing_draft_shop_listing"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)
    data_json: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class DraftFile(Base):
    """Taslağa eklenen (henüz Etsy'ye yüklenmemiş) fotoğraf/video dosyası; içerik diskte durur. Bir dosya
    ASLA silinmez (yeniden üretim eskisinin üstüne yazmaz, yeni bir satır ekler) — bu yüzden `origin_key`
    ile aynı "fotoğraf yuvası"na ait tüm sürümler gruplanıp geçmiş olarak gösterilebiliyor
    (bkz. listings/drafts.py list_versions, küpün yanındaki sürüm noktaları)."""

    __tablename__ = "listing_draft_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)
    kind: Mapped[str] = mapped_column(String(10))  # image|video
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100), default="application/octet-stream")
    path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    # Aynı "fotoğraf yuvası"nın tüm sürümlerini birbirine bağlayan anahtar: bir Etsy fotoğrafından ilk kez
    # üretildiyse "etsy-{image_id}", bir taslak dosyadan üretildiyse o dosyanın origin_key'i (zincir taşınır).
    # Yoksa (bağımsız yükleme) kendi id'si. Eski satırlarda NULL olabilir — bkz. drafts.py _resolve_origin_key.
    origin_key: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)


class ListingHealth(Base):
    """Listing'in optimizasyon/durdurma durum makinesi (bkz. listings/health.py). `jobs/listing_health.py`
    günlük olarak yeniden hesaplar: yeterli veri biriktiyse (`window_start`'tan bu yana) mağaza medyanıyla
    kıyaslar, hangi aşamada tıkandığını (`bottleneck`) teşhis eder; aynı listing `attempts` kez denenip
    hâlâ zayıfsa "kill_candidate" (durdurmayı değerlendir) işaretlenir. Etsy'ye giden hiçbir şey yok —
    kullanıcı "durdur" derse ayrıca /health/kill çağrılır."""

    __tablename__ = "listing_health"
    __table_args__ = (UniqueConstraint("shop_id", "listing_id", name="uq_listing_health_shop_listing"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)

    # watching (veri birikiyor) | flagged (öneri var) | stable (iyi, dokunma) | kill_candidate | killed
    stage: Mapped[str] = mapped_column(String(20), default="watching")
    # seo | appeal | conversion — flagged/kill_candidate'ta hangi huni aşaması zayıf
    bottleneck: Mapped[str | None] = mapped_column(String(20), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")

    # Şu anki gözlem penceresinin başlangıcı: son uygulanan değişiklik, yoksa listing'in oluşturulma tarihi
    window_start: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    # Bu pencereye kadar kaç farklı değişiklik döngüsü denendi (her yeni yayın +1)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    # Daha önce denenmiş bottleneck türleri (JSON liste) — aynı teşhisi tekrar tekrar önermemek için
    tried_bottlenecks: Mapped[str] = mapped_column(Text, default="[]")

    evaluated_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    killed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class ListingLocal(Base):
    """Kaydedilmiş yerel sürüm ("Kaydet"): listing'in düzenlenmiş hâli, henüz Etsy'ye gönderilmedi.
    Liste sayfası bunu gösterir ve "yayınlanmamış" işaretler; "Yayınla" bunu Etsy'ye uygular.
    (Etsy'nin yerel aynası ListingCache, ara kayıt ise ListingDraft'tır.)"""

    __tablename__ = "listing_locals"
    __table_args__ = (UniqueConstraint("shop_id", "listing_id", name="uq_listing_local_shop_listing"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)
    data_json: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    # Yerel kopyanın alındığı Etsy hâli (üç yönlü karşılaştırma için); kayıtlar arasında korunur.
    base_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class DescriptionTemplate(Base):
    """Kullanıcının kaydettiği hazır açıklama metni (kargo, garanti, iletişim gibi sabit kısım). Metindeki `{product}`
    satırı ürüne özel yazının yeridir (yoksa ürün yazısı başa gelir); `{title}`, `{materials}`, `{sizes}`… yer
    tutucuları listing'in bilgisiyle dolar (bkz. listings/templates.py). Mağaza başına en fazla bir varsayılan."""

    __tablename__ = "description_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    # Metnin önceki sürümleri (JSON liste, en yenisi sonda): listing'lerde eski sürüm durabilir; şablon yeniden
    # uygulanınca onun da tanınıp yenisiyle değişmesi için saklanır.
    history_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

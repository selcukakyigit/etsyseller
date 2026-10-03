import datetime as dt

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TrackedKeyword(Base):
    """Bir listing'in Etsy aramasındaki sırasının takip edildiği arama. `source`: auto (uygulama seçti), user (kullanıcı
    ekledi), etsy_data (Etsy'den yapıştırılan veride listing'i getiren arama). Kapatılan arama silinmez, geçmişi kalır."""

    __tablename__ = "tracked_keywords"
    __table_args__ = (UniqueConstraint("shop_id", "listing_id", "keyword", name="uq_tracked_keyword"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)
    keyword: Mapped[str] = mapped_column(String(100))
    source: Mapped[str] = mapped_column(String(20), default="auto")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class RankSnapshot(Base):
    """Bir aramada listing'in o günkü sırası (ilk `rank.MAX_RESULTS` içinde değilse None), aramadaki toplam listing
    sayısı ve ilk 20 sonucun fiyat dağılımı (listing'in para birimine çevrilmiş)."""

    __tablename__ = "rank_snapshots"
    __table_args__ = (UniqueConstraint("shop_id", "listing_id", "keyword", "day", name="uq_rank_snapshot_day"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(BigInteger, index=True)
    keyword: Mapped[str] = mapped_column(String(100))
    day: Mapped[dt.date] = mapped_column(Date, index=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_results: Mapped[int] = mapped_column(Integer, default=0)
    top_price_median: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_price_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_price_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    own_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="")
    captured_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class EtsyKeywordData(Base):
    """Kullanıcının Etsy panelinden yapıştırdığı arama verisi (Etsy bunu API'de vermez). `source`:
    marketplace_insights (aylık arama, arama sonucu sayısı, dönüşüm bandı ve önceki döneme göre değişim; eski
    biçimde "rekabet"), search_terms (listing'i getiren aramalar + ziyaret), ads (Etsy Ads
    arama terimleri: görüntülenme, tıklama, sipariş). `listing_id` yoksa veri mağaza geneli bir kelime araştırmasıdır.
    Her yapıştırma tarihli yeni satırlar ekler; ekranda kelime+kaynak başına en yenisi kullanılır."""

    __tablename__ = "etsy_keyword_data"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    keyword: Mapped[str] = mapped_column(String(100), index=True)
    source: Mapped[str] = mapped_column(String(30))
    searches: Mapped[int | None] = mapped_column(Integer, nullable=True)
    competition: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Marketplace Insights dönüşüm bandı: very_low | low | medium | high | very_high (alıcının bu aramada satın alma eğilimi)
    conversion: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Aramadaki değişim, önceki eşit döneme göre (%)
    trend_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    listings_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    clicks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    orders: Mapped[int | None] = mapped_column(Integer, nullable=True)
    period_start: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    captured_on: Mapped[dt.date] = mapped_column(Date, default=dt.date.today)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class DemandTrend(Base):
    """Bir aramanın Google'daki ilgisinin geçen yıla göre değişimi (son 13 hafta / geçen yılın aynı 13 haftası).
    Google Trends'ten haftada bir, yalnızca sıra takibindeki aramalar için çekilir (bkz. app/insights/demand.py)."""

    __tablename__ = "demand_trends"

    keyword: Mapped[str] = mapped_column(String(100), primary_key=True)
    recent: Mapped[float | None] = mapped_column(Float, nullable=True)
    previous: Mapped[float | None] = mapped_column(Float, nullable=True)
    yoy_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fetched_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

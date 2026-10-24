"""Ortak araştırma havuzu tabloları. Bu tablolarda `workspace_id` YOKTUR: tüm mağazalar aynı kelime ve ölçümleri okur, yalnızca sistem (worker/yönetim)
yazar. Mağazaya ait hiçbir veri (satış, taslak, performans) buraya girmez (bkz. CLAUDE.md "Research data")."""
import datetime as dt

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto import EncryptedText
from app.core.db import MONEY, Base

_ID = BigInteger().with_variant(Integer, "sqlite")


class KeywordTerm(Base):
    """Bir kelime, bir kez (normalize edilmiş). Ölçümler `KeywordMetric`te, ülke/dil/kaynak/tarihle ayrı satırlardır."""

    __tablename__ = "keyword_terms"
    __table_args__ = (UniqueConstraint("term", "language", name="uq_keyword_terms_term_language"),)

    id: Mapped[int] = mapped_column(_ID, primary_key=True, autoincrement=True)
    term: Mapped[str] = mapped_column(String(120), index=True)
    display: Mapped[str] = mapped_column(String(120))
    language: Mapped[str] = mapped_column(String(8))
    first_source: Mapped[str] = mapped_column(String(30), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    # Son istenme zamanı: yenileme yalnızca yakın zamanda kullanılan kelimeler için yapılır (kullanılmayan kelimeye para harcanmaz).
    last_used_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class KeywordMetric(Base):
    """Tarihli bir ölçüm. Yeni ölçüm eskisini ezmez, yeni satır olur; ekran en yenisini, trend geçmişi hepsini kullanır.
    `search_volume` boşsa sağlayıcı bu kelime için veri döndürmedi (ölçüm yapıldı ama sonuç yok): TTL dolana kadar yeniden sorulmaz.
    Bu GOOGLE verisidir; Etsy aramasının hacmi değildir."""

    __tablename__ = "keyword_metrics"
    __table_args__ = (
        Index("ix_keyword_metrics_lookup", "keyword_id", "market", "language", "measured_at"),
        # Yönetim listesi her kelimenin güncel ölçümünü `is_latest` ile bulur (tüm geçmişi gruplamadan); kısmi dizin yalnızca güncel satırları tutar.
        Index("ix_keyword_metrics_latest", "market", "language", "keyword_id", postgresql_where=text("is_latest"), sqlite_where=text("is_latest")),
    )

    id: Mapped[int] = mapped_column(_ID, primary_key=True, autoincrement=True)
    keyword_id: Mapped[int] = mapped_column(_ID, ForeignKey("keyword_terms.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(30))  # google_ads | labs_suggestions
    market: Mapped[str] = mapped_column(String(2))
    language: Mapped[str] = mapped_column(String(8))
    search_volume: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpc: Mapped[float | None] = mapped_column(MONEY, nullable=True)
    competition: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0–1, Google Ads REKLAM rekabeti (Etsy organik rekabeti değil)
    difficulty: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0–100
    intent: Mapped[str | None] = mapped_column(String(20), nullable=True)
    monthly_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # [[yıl, ay, hacim], …]
    measured_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime, index=True)
    # Bu kelime + pazar + dil için EN YENİ ölçüm mü (`pool.add_metrics` yeni satır eklerken eskisini kapatır).
    is_latest: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))


class KeywordTrend(Base):
    """Tarihli Google ilgi endeksi ölçümü (göreli, 0–100; hacim DEĞİL): son 13 hafta, geçen yılın aynı 13 haftası ve yüzde değişim. Yıllık değişim, geçen yılki ilgi
    çok düşükse (gürültü) hesaplanmaz ve boş kalır. Metrik gibi yeni satır eklenir, eskisi ezilmez."""

    __tablename__ = "keyword_trends"
    __table_args__ = (Index("ix_keyword_trends_lookup", "keyword_id", "market", "language", "measured_at"),)

    id: Mapped[int] = mapped_column(_ID, primary_key=True, autoincrement=True)
    keyword_id: Mapped[int] = mapped_column(_ID, ForeignKey("keyword_terms.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(20))
    market: Mapped[str] = mapped_column(String(2))
    language: Mapped[str] = mapped_column(String(8))
    recent: Mapped[float | None] = mapped_column(Float, nullable=True)
    previous: Mapped[float | None] = mapped_column(Float, nullable=True)
    yoy_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    measured_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime, index=True)


class KeywordSeason(Base):
    """Mevsimsellik profili (Google Trends, 5 yıl): takvim ayına göre göreli ilgi (zirve ay = 100). `monthly_json` boşsa veri yoktu/yetersizdi: TTL boyunca yeniden sorulmaz."""

    __tablename__ = "keyword_seasons"
    __table_args__ = (Index("ix_keyword_seasons_lookup", "keyword_id", "market", "language", "measured_at"),)

    id: Mapped[int] = mapped_column(_ID, primary_key=True, autoincrement=True)
    keyword_id: Mapped[int] = mapped_column(_ID, ForeignKey("keyword_terms.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(20))
    market: Mapped[str] = mapped_column(String(2))
    language: Mapped[str] = mapped_column(String(8))
    monthly_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # [12 sayı]
    years: Mapped[int] = mapped_column(Integer, default=0)
    measured_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime, index=True)


class KeywordLink(Base):
    """Kelimeler arası ilişki (şimdilik: tohum kelimenin önerileri). Eş anlamlıları körlemesine birleştirmez, ilişkiyi tipiyle tutar."""

    __tablename__ = "keyword_links"

    seed_id: Mapped[int] = mapped_column(_ID, ForeignKey("keyword_terms.id", ondelete="CASCADE"), primary_key=True)
    keyword_id: Mapped[int] = mapped_column(_ID, ForeignKey("keyword_terms.id", ondelete="CASCADE"), primary_key=True, index=True)
    relation: Mapped[str] = mapped_column(String(20), primary_key=True, default="suggestion")
    rank: Mapped[int] = mapped_column(Integer, default=0)
    observed_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class ResearchJob(Base):
    """Araştırma iş kuyruğu (DB tabanlı; `FOR UPDATE SKIP LOCKED` ile birden çok worker güvenle çalışır). Aynı anda tek AKTİF iş / anahtar:
    aynı sorgu iki kez kuyruğa girmez (kısmi benzersiz dizin)."""

    __tablename__ = "research_jobs"
    __table_args__ = (
        Index("ix_research_jobs_status_run", "status", "run_after"),
        Index(
            "uq_research_jobs_active_key", "idem_key", unique=True,
            postgresql_where=text("status IN ('queued','running')"), sqlite_where=text("status IN ('queued','running')"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(20))  # volume | suggest | trend | season
    provider: Mapped[str] = mapped_column(String(20))
    market: Mapped[str] = mapped_column(String(2))
    language: Mapped[str] = mapped_column(String(8))
    idem_key: Mapped[str] = mapped_column(String(200))
    params_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(12), default="queued")  # queued | running | done | failed | dead | cancelled
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    shop_id: Mapped[int | None] = mapped_column(ForeignKey("shops.id", ondelete="SET NULL"), nullable=True, index=True)
    run_after: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    locked_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    cost_usd: Mapped[float] = mapped_column(MONEY, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class ProviderCall(Base):
    """Sağlayıcıya giden her gerçek istek: maliyet, süre, sonuç. Bütçe ve yönetim panelindeki maliyet ekranı buradan hesaplanır."""

    __tablename__ = "provider_calls"

    id: Mapped[int] = mapped_column(_ID, primary_key=True, autoincrement=True)
    job_id: Mapped[int | None] = mapped_column(ForeignKey("research_jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(20))
    endpoint: Mapped[str] = mapped_column(String(80))
    market: Mapped[str] = mapped_column(String(2))
    language: Mapped[str] = mapped_column(String(8))
    items: Mapped[int] = mapped_column(Integer, default=0)  # dönen kayıt sayısı
    cost_usd: Mapped[float] = mapped_column(MONEY, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(default=True)
    error: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)


class ResearchProviderKey(Base):
    """Sağlayıcı kimlik bilgisi (şifreli). Satır yoksa .env kullanılır. Yalnızca worker/yönetim okur; arayüze asla dönmez."""

    __tablename__ = "research_provider_keys"

    provider: Mapped[str] = mapped_column(String(20), primary_key=True)
    login: Mapped[str] = mapped_column(String(200))
    password: Mapped[str] = mapped_column(EncryptedText)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class SuggestionExposure(Base):
    """Kalabalık sayacı: bir ifade son N günde KAÇ FARKLI mağazaya önerildi. Yalnızca sayı tutulur, mağaza kimliği yoktur; `exposure.rebuild`
    her gece listing_versions'tan yeniden hesaplar (aynı mağazanın tekrar tekrar önermesi sayıyı şişirmez). Puanı düşürmek için kullanılır:
    herkese aynı ifade önerilmesin."""

    __tablename__ = "suggestion_exposure"

    term: Mapped[str] = mapped_column(String(120), primary_key=True)
    shops: Mapped[int] = mapped_column(Integer, default=0)
    computed_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class PhraseOutcome(Base):
    """Bir etiketin sonuçla kanıtı: kaç FARKLI mağaza yapay zekâ önerisiyle ekledi (`applied`) ve kaçının değişikliği ölçüldü / ne çıktı. Kaynak,
    `insights/impact.py`nin kontrol gruplu önce/sonra ölçümüdür (ListingChange.result_json); burada yalnızca (ifade, sayı) vardır, mağaza kimliği yok.
    Aynı değişiklikte eklenen diğer etiket ve alanlarla BİRLİKTE ölçülür: tek ifadenin etkisi değil, "bu ifadeyle yapılan değişiklik işe yaradı mı"
    sinyalidir; nedensellik iddia edilmez. Gece `outcomes.rebuild` yeniden kurar."""

    __tablename__ = "phrase_outcomes"

    term: Mapped[str] = mapped_column(String(120), primary_key=True)
    applied: Mapped[int] = mapped_column(Integer, default=0)
    measured: Mapped[int] = mapped_column(Integer, default=0)
    better: Mapped[int] = mapped_column(Integer, default=0)
    worse: Mapped[int] = mapped_column(Integer, default=0)
    same: Mapped[int] = mapped_column(Integer, default=0)
    unclear: Mapped[int] = mapped_column(Integer, default=0)
    low_data: Mapped[int] = mapped_column(Integer, default=0)
    computed_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class SavedKeyword(Base):
    """Kullanıcının Keşfet'te kaydettiği kelime (KİRACI VERİSİ: ortak havuzdan ayrıdır, `workspace_id` ile korunur). Koleksiyon, çalışma alanı içinde serbest bir ad;
    boş ad "genel" listedir. Ölçümler burada tutulmaz, gösterilirken ortak havuzdan okunur."""

    __tablename__ = "saved_keywords"
    __table_args__ = (UniqueConstraint("workspace_id", "collection", "term", name="uq_saved_keywords_ws_collection_term"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    term: Mapped[str] = mapped_column(String(120))
    collection: Mapped[str] = mapped_column(String(60), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

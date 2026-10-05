import datetime as dt

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import MONEY, Base


class ChatSession(Base):
    """Asistan sohbeti (mağaza + kullanıcı bazında)."""

    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(120), default="Yeni sohbet")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)


class ChatMessage(Base):
    """Sohbet mesajı. `cards_json`: asistanın araçlarından dönen görsel kartlar (tablo, listing taslağı vb.)."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"), index=True)
    role: Mapped[str] = mapped_column(String(12))  # user | assistant
    content: Mapped[str] = mapped_column(Text, default="")
    image_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    cards_json: Mapped[str] = mapped_column(Text, default="[]")
    # Asistan mesajında: bu turda çağrılan araçların kısa özeti (bkz. context.summarize_tool_call). Kullanıcıya gösterilmez;
    # sonraki turlarda modele geçmişle birlikte verilir ki konuşulan listing/sipariş kimliklerini ve rakamları unutmasın.
    tool_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class ChatImage(Base):
    """Sohbete yüklenen resim ya da belge. Saklama süresi dolunca dosya silinir, `path` boşalır (bkz. cleanup.py)."""

    __tablename__ = "chat_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    session_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(80))
    path: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class AssistantMemory(Base):
    """Mağaza notu: asistanın sohbetler arasında hatırladığı kalıcı tercih ya da mağaza bilgisi (ör. "başlıklarda marka adı
    kullanılmaz"). Mağazaya bağlıdır, mağazanın tüm kullanıcıları görür; Ayarlar > Yapay Zekâ'dan görülüp silinir."""

    __tablename__ = "assistant_memories"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # notu ekleyen ya da sohbetinde kaydedilen kullanıcı
    text: Mapped[str] = mapped_column(String(300))
    source: Mapped[str] = mapped_column(String(12), default="assistant")  # assistant | user
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class AssistantUsage(Base):
    """Bir sohbet isteğinin yapay zekâ kullanımı (tüm araç turları toplamı). Maliyeti mağaza bazında izlemek ve ileride plan
    sınırları için. Etsy verisi içermez; bu yüzden "bağlantıyı kes"te silinmez, hesap silinince silinir."""

    __tablename__ = "assistant_usage"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(80))
    rounds: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)  # önbellekten okunanlar dahil toplam girdi
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)  # önbellekten (indirimli) okunan girdi
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)  # önbelleğe yazılan girdi (yalnızca Claude)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    tools: Mapped[str] = mapped_column(String(500), default="")  # çağrılan araçlar, virgülle
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)


class AdReport(Base):
    """Kullanıcının Etsy Ads panelinden yapıştırdığı bir listing reklam raporu (Etsy API'si reklam verisi vermez).
    Dönemler arası karşılaştırma ve "hangi anahtar kelime kapatılmalı" analizi için saklanır."""

    __tablename__ = "ad_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    listing_title: Mapped[str] = mapped_column(String(255), default="")
    period_start: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    spend: Mapped[float] = mapped_column(MONEY, default=0.0)
    views: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    orders: Mapped[int] = mapped_column(Integer, default=0)
    revenue: Mapped[float] = mapped_column(MONEY, default=0.0)
    keywords_json: Mapped[str] = mapped_column(Text, default="[]")
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

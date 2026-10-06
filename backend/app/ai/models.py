import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import false as sa_false, true as sa_true

from app.core.crypto import EncryptedText
from app.core.db import MONEY, Base


class AiProviderKey(Base):
    """Bir yapay zekâ sağlayıcısının (openai, anthropic, google…) uygulama geneli API anahtarı, Fernet ile şifreli.
    Satır yoksa .env'deki anahtar kullanılır (bkz. ai/catalog.py)."""

    __tablename__ = "ai_provider_keys"

    provider: Mapped[str] = mapped_column(String(30), primary_key=True)
    api_key: Mapped[str] = mapped_column(EncryptedText)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class AiModel(Base):
    """Katalogdaki bir model. Metin modellerinin fiyatı burada (sağlayıcının milyon token başına USD liste fiyatı);
    görsel/video modellerinin fiyatı ayara (çözünürlük, taslak…) göre değiştiği için `AiModelVariant` satırlarındadır."""

    __tablename__ = "ai_models"
    __table_args__ = (UniqueConstraint("provider", "model_id", name="uq_ai_models_provider_model"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(10))  # llm | image | video
    provider: Mapped[str] = mapped_column(String(30))
    model_id: Mapped[str] = mapped_column(String(120))
    label: Mapped[str] = mapped_column(String(120))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=sa_true())
    input_usd_per_mtok: Mapped[float | None] = mapped_column(MONEY, nullable=True)
    output_usd_per_mtok: Mapped[float | None] = mapped_column(MONEY, nullable=True)
    # Modelin özellikleri, ör. videoda {"durations": [5, 10], "default_duration": 5}. (Eski `unit_usd` sütunu
    # veritabanında duruyor ama kullanılmıyor; fiyat 0028'den beri seçeneklerde.)
    options_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class AiTaskModel(Base):
    """Bir görevin (asistan, SEO önerisi, görsel üretimi…) kullandığı model. Görev ataması yoksa katalog varsayılanı."""

    __tablename__ = "ai_task_models"

    task: Mapped[str] = mapped_column(String(30), primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("ai_models.id"))


class AiModelVariant(Base):
    """Görsel/video modelinin fiyatlanan bir seçeneği (ör. "720p", "1080p taslak", "2K"). Birim modelin türünden gelir:
    görselde bir görsel, videoda bir saniye.

    `cost_usd` sağlayıcının birim fiyatıdır. `credits` boşsa birim kredisi maliyetten hesaplanır (bkz. billing/pricing.py);
    doluysa yönetici o değeri sabitlemiştir. `params_json` seçenek kullanıldığında sağlayıcı API'sine olduğu gibi giden
    parametrelerdir, ör. {"resolution": "720p", "draft": false}."""

    __tablename__ = "ai_model_variants"
    __table_args__ = (UniqueConstraint("model_id", "key", name="uq_ai_model_variants_model_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("ai_models.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(40))
    label_tr: Mapped[str] = mapped_column(String(80))
    label_en: Mapped[str] = mapped_column(String(80))
    cost_usd: Mapped[float] = mapped_column(MONEY)
    credits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    params_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=sa_true())
    sort: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

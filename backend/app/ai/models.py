import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import true as sa_true

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
    """Katalogdaki bir model. Fiyatlar sağlayıcının USD liste fiyatıdır (kredi hesabı ve maliyet raporu için): metin
    modellerinde milyon token başına girdi/çıktı, görsel/video modellerinde birim (görsel ya da video saniyesi) başına."""

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
    unit_usd: Mapped[float | None] = mapped_column(MONEY, nullable=True)
    # Sağlayıcıya özel ayarlar, ör. görsel modelinde {"image_size": "2K"}.
    options_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class AiTaskModel(Base):
    """Bir görevin (asistan, SEO önerisi, görsel üretimi…) kullandığı model. Görev ataması yoksa katalog varsayılanı."""

    __tablename__ = "ai_task_models"

    task: Mapped[str] = mapped_column(String(30), primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("ai_models.id"))

import datetime as dt

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TaxonomyCache(Base):
    """Etsy kategori ağacı ve kategori özellik tanımlarının kalıcı kopyası (mağazadan bağımsız, herkese açık veri). Etsy'ye her sunucu yeniden başlangıcında
    ve her kategori için istek atılmasın diye saklanır; `fetched_at` eskiyince (bkz. store.MAX_AGE) tazelenir. Anahtarlar: "nodes", "props:<kategori kimliği>"."""

    __tablename__ = "taxonomy_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    data_json: Mapped[str] = mapped_column(Text)
    fetched_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class BannerImage(Base):
    """Üretilen ya da kırpılan bir banner görseli. Dosya kalıcı depodadır (blobstore); RETENTION sonra silinir
    (bkz. banners/service.purge_expired). Mağaza ürün fotoğraflarından türediği için Etsy bağlantısı kesilince de silinir."""

    __tablename__ = "banner_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    style: Mapped[str] = mapped_column(String(12))  # carousel | big | mini | collage
    slot: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)

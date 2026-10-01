import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto import EncryptedText
from app.core.db import Base


class Shop(Base):
    __tablename__ = "shops"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Mağazayı bağlayan kullanıcı; erişim `workspace_id` üzerinden üyelikle belirlenir.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    etsy_shop_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    etsy_user_id: Mapped[int] = mapped_column(Integer)
    shop_name: Mapped[str] = mapped_column(String(255))
    connected_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    # Elle sabitlenmiş rapor para birimi (ör. "USD"); boşsa finans raporu siparişlerden otomatik seçer.
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    # Mağaza logosu (Etsy: icon_url_fullxfull) — bağlanınca bir kez, sonra jobs/shop_profile.py ile günlük tazelenir.
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    user: Mapped["User"] = relationship(back_populates="shops")
    workspace: Mapped["Workspace"] = relationship(back_populates="shops")
    oauth_token: Mapped["OAuthToken | None"] = relationship(
        back_populates="shop", uselist=False, cascade="all, delete-orphan"
    )


class ReviewCache(Base):
    """Etsy'den senkronize edilen müşteri yorumları (bkz. jobs/reviews.py). `transaction_id` Etsy'de
    benzersiz (bir işlem en fazla bir kez değerlendirilir), bu yüzden birincil anahtar — artımlı senkron
    yalnızca daha yeni `created_at`'li yorumları çeker (order_sync'teki aynı desen)."""

    __tablename__ = "review_cache"

    transaction_id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(Integer, index=True)
    buyer_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rating: Mapped[int] = mapped_column(Integer)
    review: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, index=True)
    synced_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class OAuthState(Base):
    """Short-lived PKCE state for the Etsy connect flow, tied to the logged-in
    user who started it (the Etsy shop itself is only known once the callback
    resolves the token, see shops/service.py)."""

    __tablename__ = "oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"))
    code_verifier: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class OAuthToken(Base):
    __tablename__ = "oauth_tokens"

    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), primary_key=True)
    access_token: Mapped[str] = mapped_column(EncryptedText)
    refresh_token: Mapped[str] = mapped_column(EncryptedText)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime)

    shop: Mapped["Shop"] = relationship(back_populates="oauth_token")


class ShippingReferenceCache(Base):
    """Kargo/işlem/iade profilleri, bölümler ve üretim ortakları — listing'ler gibi Etsy'den BİR KERE çekilir ve
    burada saklanır; sayfa her açıldığında Etsy'ye istek atılmaz. `shipping_admin.py` bir yazma yapınca ilgili
    `kind` satırını siler (bir sonraki okuma Etsy'den tazeler); eskiden bunun yerine yalnızca süreç-içi bir sözlük
    (app/core/ttl_cache.py) kullanılıyordu — her `uvicorn --reload` yeniden başlatmasında sıfırlanıyordu."""

    __tablename__ = "shipping_reference_cache"
    __table_args__ = (UniqueConstraint("shop_id", "kind", name="uq_shipping_ref_cache_shop_kind"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    kind: Mapped[str] = mapped_column(String(64))
    data_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

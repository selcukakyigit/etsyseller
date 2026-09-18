import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Shop(Base):
    __tablename__ = "shops"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    etsy_shop_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    etsy_user_id: Mapped[int] = mapped_column(Integer)
    shop_name: Mapped[str] = mapped_column(String(255))
    connected_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="shops")
    oauth_token: Mapped["OAuthToken | None"] = relationship(
        back_populates="shop", uselist=False, cascade="all, delete-orphan"
    )


class OAuthState(Base):
    """Short-lived PKCE state for the Etsy connect flow, tied to the logged-in
    user who started it (the Etsy shop itself is only known once the callback
    resolves the token, see shops/service.py)."""

    __tablename__ = "oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    code_verifier: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class OAuthToken(Base):
    __tablename__ = "oauth_tokens"

    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), primary_key=True)
    access_token: Mapped[str] = mapped_column(Text)
    refresh_token: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime)

    shop: Mapped["Shop"] = relationship(back_populates="oauth_token")

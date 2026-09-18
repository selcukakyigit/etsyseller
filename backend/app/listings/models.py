import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ListingVersion(Base):
    """Append-only record of every AI suggestion or manual edit for a listing,
    plus whether/when it was applied to Etsy. This is the audit trail the
    performance analysis (ListingStatSnapshot) is compared against."""

    __tablename__ = "listing_versions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(Integer, index=True)

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


class ListingStatSnapshot(Base):
    """Daily views/favorites capture (populated by jobs/daily_stats.py in Faz B)
    used to measure whether an applied change actually helped."""

    __tablename__ = "listing_stat_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    listing_id: Mapped[int] = mapped_column(Integer, index=True)
    views: Mapped[int] = mapped_column(Integer, default=0)
    favorites: Mapped[int] = mapped_column(Integer, default=0)
    captured_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)

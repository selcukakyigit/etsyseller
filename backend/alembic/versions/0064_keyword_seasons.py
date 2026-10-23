"""keyword seasons

Mevsimsellik profili (Google Trends 5 yıl, takvim ayına göre göreli ilgi) ortak havuzda. Ortak tablo: RLS açık, politikasız (PostgREST'e kapalı).

Revision ID: 0064
Revises: 0063
Create Date: 2026-10-24 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0064'
down_revision: Union[str, None] = '0063'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ID = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "keyword_seasons",
        sa.Column("id", _ID, primary_key=True, autoincrement=True),
        sa.Column("keyword_id", _ID, sa.ForeignKey("keyword_terms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("market", sa.String(2), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("monthly_json", sa.Text(), nullable=True),
        sa.Column("years", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("measured_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_keyword_seasons_lookup", "keyword_seasons", ["keyword_id", "market", "language", "measured_at"])
    op.create_index("ix_keyword_seasons_expires_at", "keyword_seasons", ["expires_at"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.keyword_seasons ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("keyword_seasons")

"""keyword trends

Google ilgi endeksi (yıllık talep değişimi) ortak havuzda: eski pytrends tabanlı trend_cache / demand_trends yerine. Eski tabloların silinmesi, yeni sürüm
yayına çıktıktan sonra ayrı bir göçle yapılır (çalışan eski kod bu tabloları hâlâ okuyabilir). Ortak tablo: RLS açık, politikasız.

Revision ID: 0061
Revises: 0060
Create Date: 2026-10-23 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0061'
down_revision: Union[str, None] = '0060'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ID = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "keyword_trends",
        sa.Column("id", _ID, primary_key=True, autoincrement=True),
        sa.Column("keyword_id", _ID, sa.ForeignKey("keyword_terms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("market", sa.String(2), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("recent", sa.Float(), nullable=True),
        sa.Column("previous", sa.Float(), nullable=True),
        sa.Column("yoy_pct", sa.Integer(), nullable=True),
        sa.Column("measured_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_keyword_trends_lookup", "keyword_trends", ["keyword_id", "market", "language", "measured_at"])
    op.create_index("ix_keyword_trends_expires_at", "keyword_trends", ["expires_at"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.keyword_trends ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("keyword_trends")

"""drop pytrends tables

pytrends tabanlı eski trend önbelleği (trend_cache) ve yıllık talep tablosu (demand_trends) kaldırıldı: yerini ortak araştırma havuzundaki keyword_trends aldı
(bkz. 0061). Yeni sürüm yayında doğrulandıktan sonra silinir. İkisi de yeniden üretilebilir önbellek verisidir.

Revision ID: 0062
Revises: 0061
Create Date: 2026-10-23 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0062'
down_revision: Union[str, None] = '0061'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("demand_trends")
    op.drop_table("trend_cache")


def downgrade() -> None:
    op.create_table(
        "trend_cache",
        sa.Column("keyword", sa.String(255), primary_key=True),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("checked_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "demand_trends",
        sa.Column("keyword", sa.String(100), primary_key=True),
        sa.Column("recent", sa.Float(), nullable=True),
        sa.Column("previous", sa.Float(), nullable=True),
        sa.Column("yoy_pct", sa.Integer(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.trend_cache ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.demand_trends ENABLE ROW LEVEL SECURITY")

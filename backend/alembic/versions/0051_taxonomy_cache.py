"""taxonomy_cache

Etsy kategori ağacı ve kategori özellik tanımlarının kalıcı kopyası (herkese açık veri, mağazadan bağımsız).

Revision ID: 0051
Revises: 0050
Create Date: 2026-10-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0051'
down_revision: Union[str, None] = '0050'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "taxonomy_cache",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("data_json", sa.Text(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
    )
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.taxonomy_cache ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("taxonomy_cache")

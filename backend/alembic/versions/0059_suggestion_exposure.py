"""suggestion exposure

Kalabalık sayacı: bir ifadenin son günlerde kaç farklı mağazaya önerildiği (yalnızca sayı, mağaza kimliği yok). Önerilerin aynılaşmasını önlemek için
puanlamada kullanılır; her gece listing_versions'tan yeniden hesaplanır. Ortak tablo: RLS açık, politikasız (PostgREST'e kapalı).

Revision ID: 0059
Revises: 0058
Create Date: 2026-10-23 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0059'
down_revision: Union[str, None] = '0058'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "suggestion_exposure",
        sa.Column("term", sa.String(120), primary_key=True),
        sa.Column("shops", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
    )
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.suggestion_exposure ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("suggestion_exposure")

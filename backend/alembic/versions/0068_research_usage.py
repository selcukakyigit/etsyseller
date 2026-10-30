"""research usage counters

Önbellek isabeti/ıskası ve Keşfet aramaları için günlük sayaç tabloları (yalnızca sayı, mağaza kimliği yok) ve `provider_calls.kind` (iş türü başına
bütçe tavanı için). Küresel tablolar: `workspace_id` yok, RLS açık, politikasız (yalnızca sistem yazar).

Revision ID: 0068
Revises: 0067
Create Date: 2026-10-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0068'
down_revision: Union[str, None] = '0067'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("research_usage_daily", "research_searches")


def upgrade() -> None:
    op.create_table(
        "research_usage_daily",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("event", sa.String(40), primary_key=True),
        sa.Column("n", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "research_searches",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("term", sa.String(120), primary_key=True),
        sa.Column("market", sa.String(2), primary_key=True),
        sa.Column("n", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("empty", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("provider_calls", sa.Column("kind", sa.String(12), nullable=False, server_default=""))
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        for table in TABLES:
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_column("provider_calls", "kind")
    for table in TABLES:
        op.drop_table(table)

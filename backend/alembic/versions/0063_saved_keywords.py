"""saved keywords

Keşfet'te kullanıcının kaydettiği kelimeler: kiracı verisi (çalışma alanına bağlı), ortak araştırma havuzundan ayrı. RLS açık, politikasız (PostgREST'e kapalı).

Revision ID: 0063
Revises: 0062
Create Date: 2026-10-24 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0063'
down_revision: Union[str, None] = '0062'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_keywords",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("term", sa.String(120), nullable=False),
        sa.Column("collection", sa.String(60), nullable=False, server_default=""),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "collection", "term", name="uq_saved_keywords_ws_collection_term"),
    )
    op.create_index("ix_saved_keywords_workspace_id", "saved_keywords", ["workspace_id"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.saved_keywords ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("saved_keywords")

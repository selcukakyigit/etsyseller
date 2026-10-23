"""phrase outcomes

Öneri kalitesi: bir etiketin yapay zekâ önerisiyle kaç farklı mağazada uygulandığı ve kontrol gruplu ölçümün sonucu (yalnızca sayılar, mağaza kimliği yok).
Gece listing_changes.result_json'dan yeniden kurulur. Ortak tablo: RLS açık, politikasız.

Revision ID: 0060
Revises: 0059
Create Date: 2026-10-23 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0060'
down_revision: Union[str, None] = '0059'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "phrase_outcomes",
        sa.Column("term", sa.String(120), primary_key=True),
        sa.Column("applied", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("measured", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("better", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("worse", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("same", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unclear", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("low_data", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
    )
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.phrase_outcomes ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("phrase_outcomes")

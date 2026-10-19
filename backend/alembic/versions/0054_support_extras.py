"""support_extras

Destek talepleri: puan ve hata parmak izi, hazır yanıtlar, otomatik yakalanan hata grupları.

Revision ID: 0054
Revises: 0053
Create Date: 2026-10-19 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0054'
down_revision: Union[str, None] = '0053'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("support_tickets") as batch:
        batch.add_column(sa.Column("rating", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("fingerprint", sa.String(16), nullable=True))
        batch.create_index("ix_support_tickets_fingerprint", ["fingerprint"])
    op.create_table(
        "support_canned_replies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(80), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "support_error_groups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fingerprint", sa.String(16), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("message", sa.String(400), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("url", sa.String(300), nullable=False, server_default=""),
        sa.Column("status", sa.String(10), nullable=False, server_default="open"),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("first_seen", sa.DateTime(), nullable=False),
        sa.Column("last_seen", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_support_error_groups_fingerprint", "support_error_groups", ["fingerprint"], unique=True)
    op.create_index("ix_support_error_groups_status", "support_error_groups", ["status"])
    op.create_index("ix_support_error_groups_last_seen", "support_error_groups", ["last_seen"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        for table in ("support_canned_replies", "support_error_groups"):
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("support_error_groups")
    op.drop_table("support_canned_replies")
    with op.batch_alter_table("support_tickets") as batch:
        batch.drop_index("ix_support_tickets_fingerprint")
        batch.drop_column("fingerprint")
        batch.drop_column("rating")

"""support_tickets

Uygulama içi destek talepleri: talep, mesajlar (yönetici iç notları dahil) ve ekler (özel depoda).

Revision ID: 0053
Revises: 0052
Create Date: 2026-10-19 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0053'
down_revision: Union[str, None] = '0052'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("support_tickets", "support_messages", "support_attachments")


def upgrade() -> None:
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject", sa.String(160), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("context_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("user_unread", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("admin_unread", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_support_tickets_user_id", "support_tickets", ["user_id"])
    op.create_index("ix_support_tickets_status", "support_tickets", ["status"])
    op.create_index("ix_support_tickets_updated_at", "support_tickets", ["updated_at"])
    op.create_table(
        "support_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_kind", sa.String(10), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("internal", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_support_messages_ticket_id", "support_messages", ["ticket_id"])
    op.create_table(
        "support_attachments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("support_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(300), nullable=False),
    )
    op.create_index("ix_support_attachments_message_id", "support_attachments", ["message_id"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        for table in TABLES:
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_support_attachments_message_id", table_name="support_attachments")
    op.drop_table("support_attachments")
    op.drop_index("ix_support_messages_ticket_id", table_name="support_messages")
    op.drop_table("support_messages")
    op.drop_index("ix_support_tickets_updated_at", table_name="support_tickets")
    op.drop_index("ix_support_tickets_status", table_name="support_tickets")
    op.drop_index("ix_support_tickets_user_id", table_name="support_tickets")
    op.drop_table("support_tickets")

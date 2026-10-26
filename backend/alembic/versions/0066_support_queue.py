"""support_queue

Destek talepleri: atama, öncelik, kaynak, ilk yanıt zamanı; konu etiketleri ve talep olay kaydı.

Revision ID: 0066
Revises: 0065
Create Date: 2026-10-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0066'
down_revision: Union[str, None] = '0065'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("support_tickets") as batch:
        batch.add_column(sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
        batch.add_column(sa.Column("priority", sa.String(10), nullable=False, server_default="normal"))
        batch.add_column(sa.Column("source", sa.String(12), nullable=False, server_default="web"))
        batch.add_column(sa.Column("first_response_at", sa.DateTime(), nullable=True))
        batch.create_index("ix_support_tickets_assignee_id", ["assignee_id"])
    # Eski talepler için ilk yönetici yanıtı (iç not sayılmaz).
    op.get_bind().execute(sa.text(
        "UPDATE support_tickets SET first_response_at = (SELECT MIN(m.created_at) FROM support_messages m "
        "WHERE m.ticket_id = support_tickets.id AND m.author_kind = 'admin' AND m.internal = :no)"
    ).bindparams(no=False))
    op.create_table(
        "support_ticket_labels",
        sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("support_tickets.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("label", sa.String(30), primary_key=True),
    )
    op.create_index("ix_support_ticket_labels_label", "support_ticket_labels", ["label"])
    op.create_table(
        "support_ticket_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("detail", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_support_ticket_events_ticket_id", "support_ticket_events", ["ticket_id"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        for table in ("support_ticket_labels", "support_ticket_events"):
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("support_ticket_events")
    op.drop_table("support_ticket_labels")
    with op.batch_alter_table("support_tickets") as batch:
        batch.drop_index("ix_support_tickets_assignee_id")
        batch.drop_column("first_response_at")
        batch.drop_column("source")
        batch.drop_column("priority")
        batch.drop_column("assignee_id")

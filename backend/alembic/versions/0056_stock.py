"""stock

Malzeme kalemlerinde stok takibi: kalemde takip/paket/en az stok alanları ve stok hareketi defteri.

Revision ID: 0056
Revises: 0055
Create Date: 2026-10-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0056'
down_revision: Union[str, None] = '0055'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("price_items") as batch:
        batch.add_column(sa.Column("track_stock", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("min_stock", sa.Numeric(18, 6), nullable=True))
        batch.add_column(sa.Column("pack_size", sa.Numeric(18, 6), nullable=True))
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("module_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("price_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("qty", sa.Numeric(18, 6), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18, 6), nullable=True),
        sa.Column("moved_on", sa.Date(), nullable=False),
        sa.Column("ref_type", sa.String(12), nullable=False, server_default=""),
        sa.Column("ref_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_stock_movements_entity_id", "stock_movements", ["entity_id"])
    op.create_index("ix_stock_movements_item_moved", "stock_movements", ["item_id", "moved_on", "id"])
    op.create_index("ix_stock_movements_ref", "stock_movements", ["ref_type", "ref_id"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_stock_movements_ref", table_name="stock_movements")
    op.drop_index("ix_stock_movements_item_moved", table_name="stock_movements")
    op.drop_index("ix_stock_movements_entity_id", table_name="stock_movements")
    op.drop_table("stock_movements")
    with op.batch_alter_table("price_items") as batch:
        batch.drop_column("pack_size")
        batch.drop_column("min_stock")
        batch.drop_column("track_stock")

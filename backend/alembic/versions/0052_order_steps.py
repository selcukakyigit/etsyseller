"""order_steps

Siparişler için yerel ilerleme adımları (Etsy Shop Manager'daki "progress steps" gibi; Etsy API'si vermez). Mağazanın adımları `order_steps`,
siparişin bulunduğu adım `order_cache.step_id`.

Revision ID: 0052
Revises: 0051
Create Date: 2026-10-19 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0052'
down_revision: Union[str, None] = '0051'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "order_steps",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("shop_id", "name", name="uq_order_steps_shop_name"),
    )
    op.create_index("ix_order_steps_shop_id", "order_steps", ["shop_id"])
    with op.batch_alter_table("order_cache") as batch:
        batch.add_column(sa.Column("step_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_order_cache_step_id", "order_steps", ["step_id"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_order_cache_step_id", ["step_id"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.order_steps ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("order_cache") as batch:
        batch.drop_index("ix_order_cache_step_id")
        batch.drop_constraint("fk_order_cache_step_id", type_="foreignkey")
        batch.drop_column("step_id")
    op.drop_index("ix_order_steps_shop_id", table_name="order_steps")
    op.drop_table("order_steps")

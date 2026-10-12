"""product_paints

Boyacı için ürüne bağlı boya türü: ürün başına fiyat listesindeki m² kalemi (ör. "texture black", "gold").

Revision ID: 0045
Revises: 0044
Create Date: 2026-10-10 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0045'
down_revision: Union[str, None] = '0044'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "supply_product_paints",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("module_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("listing_id", sa.BigInteger(), nullable=False),
        sa.Column("variant", sa.String(300), nullable=False, server_default=""),
        sa.Column("price_item_id", sa.Integer(), sa.ForeignKey("price_items.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("entity_id", "shop_id", "listing_id", "variant", name="uq_supply_product_paints_target"),
    )
    op.create_index("ix_supply_product_paints_entity_id", "supply_product_paints", ["entity_id"])
    op.create_index("ix_supply_product_paints_price_item_id", "supply_product_paints", ["price_item_id"])


def downgrade() -> None:
    op.drop_index("ix_supply_product_paints_price_item_id", table_name="supply_product_paints")
    op.drop_index("ix_supply_product_paints_entity_id", table_name="supply_product_paints")
    op.drop_table("supply_product_paints")

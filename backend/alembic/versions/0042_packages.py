"""packages

Ambalaj: paket türleri (tedarikçi kaydına bağlı tarifler), satırları ve ürünlere atamalar. Yalnızca yeni tablolar eklenir.

Revision ID: 0042
Revises: 0041
Create Date: 2026-10-10 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0042'
down_revision: Union[str, None] = '0041'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "supply_package_types",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("module_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_supply_package_types_entity_id", "supply_package_types", ["entity_id"])
    op.create_table(
        "supply_package_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("package_id", sa.Integer(), sa.ForeignKey("supply_package_types.id", ondelete="CASCADE"), nullable=False),
        sa.Column("price_item_id", sa.Integer(), sa.ForeignKey("price_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("constant", sa.Numeric(14, 4, asdecimal=False), nullable=False, server_default="0"),
        sa.Column("per_long", sa.Numeric(14, 4, asdecimal=False), nullable=False, server_default="0"),
        sa.Column("per_short", sa.Numeric(14, 4, asdecimal=False), nullable=False, server_default="0"),
        sa.Column("per_area", sa.Numeric(14, 4, asdecimal=False), nullable=False, server_default="0"),
        sa.Column("min_long", sa.Numeric(10, 2, asdecimal=False), nullable=True),
        sa.Column("max_long", sa.Numeric(10, 2, asdecimal=False), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_supply_package_lines_package_id", "supply_package_lines", ["package_id"])
    op.create_index("ix_supply_package_lines_price_item_id", "supply_package_lines", ["price_item_id"])
    op.create_table(
        "supply_product_packages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("listing_id", sa.BigInteger(), nullable=False),
        sa.Column("variant", sa.String(300), nullable=False, server_default=""),
        sa.Column("package_id", sa.Integer(), sa.ForeignKey("supply_package_types.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_supply_product_packages_workspace_id", "supply_product_packages", ["workspace_id"])
    op.create_index("ix_supply_product_packages_shop_id", "supply_product_packages", ["shop_id"])
    op.create_index("ix_supply_product_packages_package_id", "supply_product_packages", ["package_id"])


def downgrade() -> None:
    op.drop_table("supply_product_packages")
    op.drop_table("supply_package_lines")
    op.drop_table("supply_package_types")

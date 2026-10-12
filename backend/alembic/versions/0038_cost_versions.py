"""cost versions

Birim maliyetin tarihli sürümleri (Dış Tedarik'ten uygulanan maliyetler): geçmiş siparişler kendi tarihindeki maliyetle, ürün
kârlılığı güncel maliyetle hesaplanır. Yalnızca yeni tablo eklenir.

Revision ID: 0038
Revises: 0037
Create Date: 2026-10-09 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0038'
down_revision: Union[str, None] = '0037'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cost_versions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id"), nullable=False),
        sa.Column("listing_id", sa.BigInteger(), nullable=False),
        sa.Column("variant_key", sa.String(300), nullable=False, server_default=""),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("unit_cost", sa.Numeric(14, 4, asdecimal=False), nullable=False, server_default="0"),
        sa.Column("source", sa.String(12), nullable=False, server_default=""),
        sa.Column("ref", sa.String(40), nullable=False, server_default=""),
    )
    op.create_index("ix_cost_versions_shop_id", "cost_versions", ["shop_id"])
    op.create_index("ix_cost_versions_ref", "cost_versions", ["ref"])


def downgrade() -> None:
    op.drop_index("ix_cost_versions_ref", table_name="cost_versions")
    op.drop_index("ix_cost_versions_shop_id", table_name="cost_versions")
    op.drop_table("cost_versions")

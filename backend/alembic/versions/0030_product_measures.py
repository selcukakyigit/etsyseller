"""product measures

Bir mağaza ürününün modül kaydındaki üretim ölçüleri (kesim uzunluğu, delme sayısı, ebat): maliyet paylaştırması bu
ölçülere göre yapılabilir. Yalnızca yeni tablo eklenir. Kayıt ya da mağaza silinince ölçüler zincirleme silinir.

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-08 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0030'
down_revision: Union[str, None] = '0029'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "entity_product_measures",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("module_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("listing_id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.String(30), nullable=False),
        sa.Column("value", sa.Numeric(18, 4, asdecimal=False), nullable=False),
        sa.Column("source", sa.String(8), nullable=False, server_default="manual"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("entity_id", "shop_id", "listing_id", "key", name="uq_product_measures_target_key"),
    )
    op.create_index("ix_entity_product_measures_entity_id", "entity_product_measures", ["entity_id"])
    op.create_index("ix_entity_product_measures_shop_id", "entity_product_measures", ["shop_id"])

    # Bu proje tablolarında RLS açık tutulur (bkz. 0029 ve core/db_guard.py).
    if op.get_bind().dialect.name == "postgresql":
        op.execute('ALTER TABLE "entity_product_measures" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    op.drop_table("entity_product_measures")

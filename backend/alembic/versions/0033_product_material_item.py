"""product material item

Ürünün malzemesi artık sabit bir liste değil, kaydın fiyat listesindeki bir malzeme kalemidir: `entity_product_measures.item_id`
(kalem silinirse SET NULL). 0032'deki `text` sütunu (sabit malzeme listesi için eklenmişti) kullanılmıyor; kaldırılır.

Revision ID: 0033
Revises: 0032
Create Date: 2026-10-09 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0033'
down_revision: Union[str, None] = '0032'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("entity_product_measures", "text")
    op.add_column("entity_product_measures", sa.Column("item_id", sa.Integer(), sa.ForeignKey("price_items.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_entity_product_measures_item_id", "entity_product_measures", ["item_id"])


def downgrade() -> None:
    op.drop_index("ix_entity_product_measures_item_id", table_name="entity_product_measures")
    op.drop_column("entity_product_measures", "item_id")
    op.add_column("entity_product_measures", sa.Column("text", sa.String(60), nullable=False, server_default=""))

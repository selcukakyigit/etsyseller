"""product parts

Bir ürün birden çok parçadan (farklı ebat ve malzeme) oluşabilir: ölçü satırlarına `part` eklenir (mevcut satırlar 0. parça),
benzersiz anahtar parçayı da içerir.

Revision ID: 0037
Revises: 0036
Create Date: 2026-10-09 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0037'
down_revision: Union[str, None] = '0036'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UQ = "uq_product_measures_target_key"


def upgrade() -> None:
    op.add_column("entity_product_measures", sa.Column("part", sa.SmallInteger(), nullable=False, server_default="0"))
    op.drop_constraint(UQ, "entity_product_measures", type_="unique")
    op.create_unique_constraint(UQ, "entity_product_measures", ["entity_id", "shop_id", "listing_id", "variant", "part", "key"])


def downgrade() -> None:
    op.drop_constraint(UQ, "entity_product_measures", type_="unique")
    op.create_unique_constraint(UQ, "entity_product_measures", ["entity_id", "shop_id", "listing_id", "variant", "key"])
    op.drop_column("entity_product_measures", "part")

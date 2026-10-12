"""product variants

Ürün kimliği "listing + seçenek (varyasyon)" olur: `entity_product_measures.variant` ve `supply_allocations.variant`
("" = tüm ürün, mevcut kayıtlar bu değeri alır). Ürün ölçülerinin benzersizlik kısıtı seçeneği de kapsar.
Yalnızca varsayılanı boş yeni sütunlar eklenir; mevcut satırlar değişmez.

Revision ID: 0034
Revises: 0033
Create Date: 2026-10-09 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0034'
down_revision: Union[str, None] = '0033'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UQ = "uq_product_measures_target_key"


def upgrade() -> None:
    op.add_column("entity_product_measures", sa.Column("variant", sa.String(300), nullable=False, server_default=""))
    op.drop_constraint(UQ, "entity_product_measures", type_="unique")
    op.create_unique_constraint(UQ, "entity_product_measures", ["entity_id", "shop_id", "listing_id", "variant", "key"])
    op.add_column("supply_allocations", sa.Column("variant", sa.String(300), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("supply_allocations", "variant")
    op.drop_constraint(UQ, "entity_product_measures", type_="unique")
    op.create_unique_constraint(UQ, "entity_product_measures", ["entity_id", "shop_id", "listing_id", "key"])
    op.drop_column("entity_product_measures", "variant")

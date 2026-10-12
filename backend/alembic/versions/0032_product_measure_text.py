"""product measure text

Ürün ölçülerine metin değeri (malzeme cinsi gibi): `entity_product_measures.text`. Yalnızca yeni, varsayılanı boş bir
sütun eklenir; mevcut satırlar değişmez.

Revision ID: 0032
Revises: 0031
Create Date: 2026-10-08 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0032'
down_revision: Union[str, None] = '0031'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("entity_product_measures", sa.Column("text", sa.String(60), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("entity_product_measures", "text")

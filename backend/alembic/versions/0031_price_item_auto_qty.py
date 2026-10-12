"""price item auto quantity

Fiyat listesi kalemine tüketim kuralı: `auto_qty` doluysa kalem her yeni işe bu miktarla kendiliğinden eklenir.
Yalnızca yeni, boş (null) bir sütun eklenir; mevcut kalemler değişmez.

Revision ID: 0031
Revises: 0030
Create Date: 2026-10-08 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0031'
down_revision: Union[str, None] = '0030'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("price_items", sa.Column("auto_qty", sa.Numeric(18, 6, asdecimal=False), nullable=True))


def downgrade() -> None:
    op.drop_column("price_items", "auto_qty")

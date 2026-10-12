"""drop_package_ranges

Paket satırlarındaki uzun kenar aralığı (min_long/max_long) kaldırıldı: paket türü ürüne elle atanıyor, aralık gereksizdi.

Revision ID: 0044
Revises: 0043
Create Date: 2026-10-10 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0044'
down_revision: Union[str, None] = '0043'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("supply_package_lines", "max_long")
    op.drop_column("supply_package_lines", "min_long")


def downgrade() -> None:
    op.add_column("supply_package_lines", sa.Column("min_long", sa.Numeric(10, 2, asdecimal=False), nullable=True))
    op.add_column("supply_package_lines", sa.Column("max_long", sa.Numeric(10, 2, asdecimal=False), nullable=True))

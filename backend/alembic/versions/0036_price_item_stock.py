"""price item stock (material) fields

Malzeme kalemine tür, kalınlık ve isteğe bağlı plaka boyutu/ağırlığı: ürünün malzeme maliyeti bunlardan hesaplanır.
Yalnızca yeni, boş bırakılabilir sütunlar eklenir.

Revision ID: 0036
Revises: 0035
Create Date: 2026-10-09 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0036'
down_revision: Union[str, None] = '0035'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = (
    ("material", sa.String(20)),
    ("thickness_mm", sa.Numeric(10, 3, asdecimal=False)),
    ("plate_width", sa.Numeric(12, 2, asdecimal=False)),
    ("plate_height", sa.Numeric(12, 2, asdecimal=False)),
    ("plate_kg", sa.Numeric(12, 3, asdecimal=False)),
)


def upgrade() -> None:
    for name, kind in COLUMNS:
        op.add_column("price_items", sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    for name, _kind in reversed(COLUMNS):
        op.drop_column("price_items", name)

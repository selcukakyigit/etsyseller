"""job material cost

Onay anındaki malzeme tahmini: raporlarda maliyetin malzeme / hizmet / sabit ücret dağılımı için. Yalnızca yeni, boş bırakılabilir sütun.

Revision ID: 0039
Revises: 0038
Create Date: 2026-10-09 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0039'
down_revision: Union[str, None] = '0038'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("supply_jobs", sa.Column("material_cost", sa.Numeric(14, 4, asdecimal=False), nullable=True))


def downgrade() -> None:
    op.drop_column("supply_jobs", "material_cost")

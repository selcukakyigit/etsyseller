"""job time fee and material switch

İş başına süre (lazer) bedeli ve "malzeme kesimciden" anahtarı: "tahmini maliyete göre" dağıtım için. Yalnızca yeni sütunlar
eklenir (`with_material` mevcut işlerde true).

Revision ID: 0035
Revises: 0034
Create Date: 2026-10-09 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0035'
down_revision: Union[str, None] = '0034'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("supply_jobs", sa.Column("time_fee", sa.Numeric(14, 4, asdecimal=False), nullable=True))
    op.add_column("supply_jobs", sa.Column("with_material", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    op.drop_column("supply_jobs", "with_material")
    op.drop_column("supply_jobs", "time_fee")

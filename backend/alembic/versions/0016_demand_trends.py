"""demand trends

Aramaların Google'daki ilgisinin geçen yıla göre değişimi (bkz. app/insights/demand.py).

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-02 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0016'
down_revision: Union[str, None] = '0015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'demand_trends',
        sa.Column('keyword', sa.String(length=100), primary_key=True),
        sa.Column('recent', sa.Float(), nullable=True),
        sa.Column('previous', sa.Float(), nullable=True),
        sa.Column('yoy_pct', sa.Integer(), nullable=True),
        sa.Column('fetched_at', sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('demand_trends')

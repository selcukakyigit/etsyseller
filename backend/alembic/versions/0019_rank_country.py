"""rank country

Sıra takibinin hangi ülkedeki alıcıya göre ölçüleceği (bkz. app/insights/rank.py). Boşsa otomatik: mağazanın son 12
ayda en çok sattığı ülke, sipariş yoksa ABD.

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-03 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0019'
down_revision: Union[str, None] = '0018'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shops', sa.Column('rank_country', sa.String(length=2), nullable=True))


def downgrade() -> None:
    op.drop_column('shops', 'rank_country')

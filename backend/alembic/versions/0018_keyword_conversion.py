"""keyword conversion

Etsy Marketplace Insights artık "rekabet" yerine aramanın dönüşüm oranını (very_low…very_high) ve aramadaki
değişimi (önceki döneme göre %) gösteriyor; ikisi de saklanır (bkz. app/insights/etsy_data.py).

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-03 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0018'
down_revision: Union[str, None] = '0017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('etsy_keyword_data', sa.Column('conversion', sa.String(length=20), nullable=True))
    op.add_column('etsy_keyword_data', sa.Column('trend_pct', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('etsy_keyword_data', 'trend_pct')
    op.drop_column('etsy_keyword_data', 'conversion')

"""cost history for date-effective costs

Revision ID: f6b8d0e2a4c7
Revises: e5a7c9d1f3b6
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f6b8d0e2a4c7'
down_revision: Union[str, None] = 'e5a7c9d1f3b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cost_history',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('variant_key', sa.String(300), nullable=False, server_default=''),
        sa.Column('valid_until', sa.Date(), nullable=False),
        sa.Column('unit_cost', sa.Float(), nullable=False, server_default='0'),
        sa.Column('shipping_cost', sa.Float(), nullable=False, server_default='0'),
        sa.Column('cost_pct', sa.Float(), nullable=False, server_default='0'),
    )
    op.create_index('ix_cost_history_shop_id', 'cost_history', ['shop_id'])
    op.create_index('ix_cost_history_listing_id', 'cost_history', ['listing_id'])


def downgrade() -> None:
    op.drop_table('cost_history')

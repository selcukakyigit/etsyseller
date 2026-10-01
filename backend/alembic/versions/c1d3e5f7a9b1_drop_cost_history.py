"""cost_history tablosu kaldırıldı: maliyet sürümleme yok, her düzenleme tüm geçmişe uygulanır

Revision ID: c1d3e5f7a9b1
Revises: a7c9e1f3b5d7
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c1d3e5f7a9b1'
down_revision: Union[str, None] = 'a7c9e1f3b5d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('cost_history')


def downgrade() -> None:
    op.create_table(
        'cost_history',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('variant_key', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('valid_until', sa.Date(), nullable=False),
        sa.Column('unit_cost', sa.Float(), nullable=False, server_default='0'),
        sa.Column('shipping_cost', sa.Float(), nullable=False, server_default='0'),
        sa.Column('cost_pct', sa.Float(), nullable=False, server_default='0'),
    )
    op.create_index('ix_cost_history_shop_id', 'cost_history', ['shop_id'])
    op.create_index('ix_cost_history_listing_id', 'cost_history', ['listing_id'])

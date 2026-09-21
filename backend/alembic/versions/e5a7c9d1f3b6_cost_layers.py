"""variant/order costs and percent cost

Revision ID: e5a7c9d1f3b6
Revises: d4f6b8c0e2a5
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e5a7c9d1f3b6'
down_revision: Union[str, None] = 'd4f6b8c0e2a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('listing_costs') as batch:
        batch.add_column(sa.Column('cost_pct', sa.Float(), nullable=False, server_default='0'))
    op.create_table(
        'variant_costs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('variant_key', sa.String(300), nullable=False),
        sa.Column('unit_cost', sa.Float(), nullable=False, server_default='0'),
        sa.Column('shipping_cost', sa.Float(), nullable=False, server_default='0'),
        sa.Column('cost_pct', sa.Float(), nullable=False, server_default='0'),
        sa.UniqueConstraint('shop_id', 'listing_id', 'variant_key', name='uq_variant_cost'),
    )
    op.create_index('ix_variant_costs_shop_id', 'variant_costs', ['shop_id'])
    op.create_table(
        'order_costs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('receipt_id', sa.Integer(), nullable=False),
        sa.Column('cost', sa.Float(), nullable=False, server_default='0'),
        sa.Column('note', sa.String(255), nullable=False, server_default=''),
        sa.UniqueConstraint('shop_id', 'receipt_id', name='uq_order_cost'),
    )
    op.create_index('ix_order_costs_shop_id', 'order_costs', ['shop_id'])


def downgrade() -> None:
    op.drop_table('order_costs')
    op.drop_table('variant_costs')
    with op.batch_alter_table('listing_costs') as batch:
        batch.drop_column('cost_pct')

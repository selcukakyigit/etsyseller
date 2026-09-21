"""add listing cache

Revision ID: d3bacb99ce29
Revises: 74b37b8c54ee
Create Date: 2026-09-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3bacb99ce29'
down_revision: Union[str, None] = '74b37b8c54ee'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'listing_cache',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('views', sa.Integer(), nullable=False),
        sa.Column('favorites', sa.Integer(), nullable=False),
        sa.Column('raw_json', sa.Text(), nullable=False),
        sa.Column('inventory_json', sa.Text(), nullable=False),
        sa.Column('properties_json', sa.Text(), nullable=False),
        sa.Column('synced_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['shop_id'], ['shops.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shop_id', 'listing_id', name='uq_listing_cache_shop_listing'),
    )
    op.create_index(op.f('ix_listing_cache_shop_id'), 'listing_cache', ['shop_id'])
    op.create_index(op.f('ix_listing_cache_listing_id'), 'listing_cache', ['listing_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_listing_cache_listing_id'), table_name='listing_cache')
    op.drop_index(op.f('ix_listing_cache_shop_id'), table_name='listing_cache')
    op.drop_table('listing_cache')

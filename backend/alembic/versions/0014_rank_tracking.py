"""rank tracking

Listing'lerin Etsy aramasındaki sırasının günlük takibi (bkz. app/insights/rank.py).

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-02 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0014'
down_revision: Union[str, None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tracked_keywords',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.BigInteger(), nullable=False),
        sa.Column('keyword', sa.String(length=100), nullable=False),
        sa.Column('source', sa.String(length=20), nullable=False, server_default='auto'),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('shop_id', 'listing_id', 'keyword', name='uq_tracked_keyword'),
    )
    op.create_index('ix_tracked_keywords_shop_id', 'tracked_keywords', ['shop_id'])
    op.create_index('ix_tracked_keywords_listing_id', 'tracked_keywords', ['listing_id'])
    op.create_table(
        'rank_snapshots',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.BigInteger(), nullable=False),
        sa.Column('keyword', sa.String(length=100), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=True),
        sa.Column('total_results', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('top_price_median', sa.Float(), nullable=True),
        sa.Column('top_price_low', sa.Float(), nullable=True),
        sa.Column('top_price_high', sa.Float(), nullable=True),
        sa.Column('own_price', sa.Float(), nullable=True),
        sa.Column('currency', sa.String(length=10), nullable=False, server_default=''),
        sa.Column('captured_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('shop_id', 'listing_id', 'keyword', 'day', name='uq_rank_snapshot_day'),
    )
    op.create_index('ix_rank_snapshots_shop_id', 'rank_snapshots', ['shop_id'])
    op.create_index('ix_rank_snapshots_listing_id', 'rank_snapshots', ['listing_id'])
    op.create_index('ix_rank_snapshots_day', 'rank_snapshots', ['day'])


def downgrade() -> None:
    op.drop_table('rank_snapshots')
    op.drop_table('tracked_keywords')

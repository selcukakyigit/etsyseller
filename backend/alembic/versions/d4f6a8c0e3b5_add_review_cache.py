"""add review cache

Revision ID: d4f6a8c0e3b5
Revises: c3e5f7a9b1d4
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4f6a8c0e3b5'
down_revision: Union[str, None] = 'c3e5f7a9b1d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'review_cache',
        sa.Column('transaction_id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('buyer_user_id', sa.Integer(), nullable=True),
        sa.Column('rating', sa.Integer(), nullable=False),
        sa.Column('review', sa.Text(), nullable=False),
        sa.Column('language', sa.String(length=10), nullable=True),
        sa.Column('image_url', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('synced_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['shop_id'], ['shops.id']),
        sa.PrimaryKeyConstraint('transaction_id'),
    )
    op.create_index(op.f('ix_review_cache_shop_id'), 'review_cache', ['shop_id'])
    op.create_index(op.f('ix_review_cache_listing_id'), 'review_cache', ['listing_id'])
    op.create_index(op.f('ix_review_cache_created_at'), 'review_cache', ['created_at'])


def downgrade() -> None:
    op.drop_table('review_cache')

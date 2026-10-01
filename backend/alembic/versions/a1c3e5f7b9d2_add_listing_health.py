"""add listing health

Revision ID: a1c3e5f7b9d2
Revises: c1d3e5f7a9b1
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c3e5f7b9d2'
down_revision: Union[str, None] = 'c1d3e5f7a9b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'listing_health',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('stage', sa.String(length=20), nullable=False),
        sa.Column('bottleneck', sa.String(length=20), nullable=True),
        sa.Column('note', sa.Text(), nullable=False),
        sa.Column('window_start', sa.DateTime(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('tried_bottlenecks', sa.Text(), nullable=False),
        sa.Column('evaluated_at', sa.DateTime(), nullable=True),
        sa.Column('killed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['shop_id'], ['shops.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shop_id', 'listing_id', name='uq_listing_health_shop_listing'),
    )
    op.create_index(op.f('ix_listing_health_shop_id'), 'listing_health', ['shop_id'])
    op.create_index(op.f('ix_listing_health_listing_id'), 'listing_health', ['listing_id'])


def downgrade() -> None:
    op.drop_table('listing_health')

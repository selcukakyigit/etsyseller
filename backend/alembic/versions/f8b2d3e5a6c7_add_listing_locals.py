"""add listing locals

Revision ID: f8b2d3e5a6c7
Revises: e7a1c2d4f5b6
Create Date: 2026-09-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f8b2d3e5a6c7'
down_revision: Union[str, None] = 'e7a1c2d4f5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'listing_locals',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('data_json', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['shop_id'], ['shops.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shop_id', 'listing_id', name='uq_listing_local_shop_listing'),
    )
    op.create_index(op.f('ix_listing_locals_shop_id'), 'listing_locals', ['shop_id'])
    op.create_index(op.f('ix_listing_locals_listing_id'), 'listing_locals', ['listing_id'])


def downgrade() -> None:
    op.drop_table('listing_locals')

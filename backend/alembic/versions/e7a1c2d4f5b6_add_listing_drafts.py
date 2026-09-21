"""add listing drafts

Revision ID: e7a1c2d4f5b6
Revises: d3bacb99ce29
Create Date: 2026-09-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7a1c2d4f5b6'
down_revision: Union[str, None] = 'd3bacb99ce29'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'listing_drafts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('data_json', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['shop_id'], ['shops.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shop_id', 'listing_id', name='uq_listing_draft_shop_listing'),
    )
    op.create_index(op.f('ix_listing_drafts_shop_id'), 'listing_drafts', ['shop_id'])
    op.create_index(op.f('ix_listing_drafts_listing_id'), 'listing_drafts', ['listing_id'])

    op.create_table(
        'listing_draft_files',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('shop_id', sa.Integer(), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=100), nullable=False),
        sa.Column('path', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['shop_id'], ['shops.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_listing_draft_files_shop_id'), 'listing_draft_files', ['shop_id'])
    op.create_index(op.f('ix_listing_draft_files_listing_id'), 'listing_draft_files', ['listing_id'])


def downgrade() -> None:
    op.drop_table('listing_draft_files')
    op.drop_table('listing_drafts')

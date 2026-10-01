"""add draft file origin_key

Revision ID: b2d4f6a8c0e3
Revises: a1c3e5f7b9d2
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2d4f6a8c0e3'
down_revision: Union[str, None] = 'a1c3e5f7b9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('listing_draft_files', sa.Column('origin_key', sa.String(length=40), nullable=True))
    op.create_index(op.f('ix_listing_draft_files_origin_key'), 'listing_draft_files', ['origin_key'])


def downgrade() -> None:
    op.drop_index(op.f('ix_listing_draft_files_origin_key'), table_name='listing_draft_files')
    op.drop_column('listing_draft_files', 'origin_key')

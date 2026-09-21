"""add variation images and personalization to listing cache

Revision ID: a9c3e1f2b4d5
Revises: f8b2d3e5a6c7
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a9c3e1f2b4d5'
down_revision: Union[str, None] = 'f8b2d3e5a6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('listing_cache') as batch:
        batch.add_column(sa.Column('variation_images_json', sa.Text(), nullable=False, server_default='[]'))
        batch.add_column(sa.Column('personalization_json', sa.Text(), nullable=False, server_default='[]'))
        batch.add_column(sa.Column('extras_synced', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('listing_cache') as batch:
        batch.drop_column('extras_synced')
        batch.drop_column('personalization_json')
        batch.drop_column('variation_images_json')

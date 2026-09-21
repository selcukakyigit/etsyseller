"""add base snapshot to listing locals

Revision ID: b1d4f6a8c2e3
Revises: a9c3e1f2b4d5
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b1d4f6a8c2e3'
down_revision: Union[str, None] = 'a9c3e1f2b4d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('listing_locals') as batch:
        batch.add_column(sa.Column('base_json', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('listing_locals') as batch:
        batch.drop_column('base_json')

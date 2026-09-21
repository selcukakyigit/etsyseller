"""add trend cache

Revision ID: 74b37b8c54ee
Revises: be4e6b50e493
Create Date: 2026-09-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '74b37b8c54ee'
down_revision: Union[str, None] = 'be4e6b50e493'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'trend_cache',
        sa.Column('keyword', sa.String(length=255), nullable=False),
        sa.Column('score', sa.Integer(), nullable=False),
        sa.Column('checked_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('keyword'),
    )


def downgrade() -> None:
    op.drop_table('trend_cache')

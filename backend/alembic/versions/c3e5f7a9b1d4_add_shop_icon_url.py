"""add shop icon_url

Revision ID: c3e5f7a9b1d4
Revises: b2d4f6a8c0e3
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3e5f7a9b1d4'
down_revision: Union[str, None] = 'b2d4f6a8c0e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shops', sa.Column('icon_url', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('shops', 'icon_url')

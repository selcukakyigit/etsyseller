"""add user profile fields

Revision ID: be4e6b50e493
Revises: c5b47d9eabb2
Create Date: 2026-09-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'be4e6b50e493'
down_revision: Union[str, None] = 'c5b47d9eabb2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('name', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('avatar_filename', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'avatar_filename')
    op.drop_column('users', 'name')

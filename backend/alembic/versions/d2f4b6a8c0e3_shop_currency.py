"""shop currency (elle sabitlenen rapor para birimi)

Revision ID: d2f4b6a8c0e3
Revises: c9e1a3b5d7f0
Create Date: 2026-09-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd2f4b6a8c0e3'
down_revision: Union[str, None] = 'c9e1a3b5d7f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shops') as batch:
        batch.add_column(sa.Column('currency', sa.String(length=3), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('shops') as batch:
        batch.drop_column('currency')

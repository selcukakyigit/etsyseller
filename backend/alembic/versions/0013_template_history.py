"""description template history

Şablonun önceki metinleri: listing'lerde eski sürüm durabilir, yeniden uygulanınca tanınması için.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-02 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0013'
down_revision: Union[str, None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('description_templates', sa.Column('history_json', sa.Text(), nullable=False, server_default='[]'))


def downgrade() -> None:
    op.drop_column('description_templates', 'history_json')

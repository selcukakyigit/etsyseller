"""user last path (online users)

Yönetim panelinde "şu an çevrimiçi" listesi: kullanıcının en son bulunduğu sayfa (yalnızca yol, sorgu dizesi yok).
Tarayıcı, sekme görünürken dakikada bir /api/auth/ping gönderir.

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-05 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0026'
down_revision: Union[str, None] = '0025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_access', sa.Column('last_path', sa.String(200), nullable=True))
    op.create_index('ix_user_access_last_seen_at', 'user_access', ['last_seen_at'])


def downgrade() -> None:
    op.drop_index('ix_user_access_last_seen_at', 'user_access')
    op.drop_column('user_access', 'last_path')

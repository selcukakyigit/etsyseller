"""shop access revoked

Satıcı Ulagg'ı Etsy hesabından kaldırınca (belirteç yenileme invalid_grant) mağaza işaretlenir: Etsy'ye istek atılmaz,
belirli süre içinde yeniden bağlanmazsa Etsy'den gelen veri silinir (Etsy API Şartları: veri gerektiğinden uzun
saklanmaz).

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-03 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0021'
down_revision: Union[str, None] = '0020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shops', sa.Column('access_revoked_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('shops', 'access_revoked_at')

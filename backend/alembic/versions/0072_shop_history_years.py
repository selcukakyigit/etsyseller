"""shops.history_years: bağlanınca seçilen geçmiş veri süresi

Boş (NULL) = henüz seçilmedi (yeni bağlanan mağaza; yalnızca son siparişler gelir, geçmiş indirme seçimden sonra başlar). 0 = tüm geçmiş, 1/2/3 = yıl.
Bu göçten ÖNCE bağlanmış mağazalar tüm geçmişi zaten indirdi ya da indiriyordu: 0 (tümü) yazılır, davranışları değişmez.

Revision ID: 0072
Revises: 0071
Create Date: 2026-11-01 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0072'
down_revision: Union[str, None] = '0071'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("shops", sa.Column("history_years", sa.Integer(), nullable=True))
    op.execute("UPDATE shops SET history_years = 0")


def downgrade() -> None:
    op.drop_column("shops", "history_years")

"""credit_components

Kredi defterinde harcamanın platform payı ayrı tutulur (`platform_credits`; kalan sağlayıcı payıdır) ve metin modeline yönetici sabit
çağrı kredisi yazabilir (`ai_models.fixed_credits`).

Revision ID: 0048
Revises: 0047
Create Date: 2026-10-13 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0048'
down_revision: Union[str, None] = '0047'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("credit_ledger", sa.Column("platform_credits", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("ai_models", sa.Column("fixed_credits", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_models", "fixed_credits")
    op.drop_column("credit_ledger", "platform_credits")

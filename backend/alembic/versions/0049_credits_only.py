"""credits_only

Abonelik yok, yalnızca kredi: plan kovası ve abonelik tablosu kalkar, tek bakiye `balance` olur, defterden `bucket`, ürünlerden `kind` ve `interval` kalkar.
Önce plan kredisi satın alınan krediye katılır (kayıp olmasın; yayına çıkarken hiçbir hesapta yoktu).

Revision ID: 0049
Revises: 0048
Create Date: 2026-10-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0049'
down_revision: Union[str, None] = '0048'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE credit_balances SET purchased = purchased + plan")
    op.drop_column("credit_balances", "plan")
    op.alter_column("credit_balances", "purchased", new_column_name="balance")
    op.drop_column("credit_ledger", "bucket")
    op.execute("DELETE FROM billing_products WHERE kind = 'plan'")
    op.drop_column("billing_products", "kind")
    op.drop_column("billing_products", "interval")
    op.drop_table("subscriptions")


def downgrade() -> None:
    raise NotImplementedError("Abonelik kaldırması geri alınmaz.")

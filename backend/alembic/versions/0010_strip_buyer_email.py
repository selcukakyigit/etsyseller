"""strip buyer email from cached receipts

Alıcı e-postası artık saklanmıyor (bkz. orders/service.py _DROPPED_RECEIPT_FIELDS); eski kayıtlardaki
buyer_email/payment_email alanları ham sipariş JSON'undan silinir. Geri alınamaz, downgrade boştur.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0010'
down_revision: Union[str, None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "UPDATE order_cache SET raw_json = ((raw_json::jsonb) - 'buyer_email' - 'payment_email')::text "
            "WHERE raw_json LIKE '%\\_email%'"
        )
    else:
        op.execute(
            "UPDATE order_cache SET raw_json = json_remove(raw_json, '$.buyer_email', '$.payment_email') "
            "WHERE raw_json LIKE '%_email%'"
        )


def downgrade() -> None:
    pass

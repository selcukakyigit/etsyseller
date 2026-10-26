"""price_item_pack_unit

Fiyat listesi kalemi: alış paketinin türü (paket, rulo, koli…). Paketteki miktar zaten `pack_size`.

Revision ID: 0067
Revises: 0066
Create Date: 2026-10-26 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0067'
down_revision: Union[str, None] = '0066'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("price_items") as batch:
        batch.add_column(sa.Column("pack_unit", sa.String(12), nullable=True))
    # Paket miktarı girilmiş eski kalemler ("paket" diye sayılıyordu): tür "paket" olur.
    op.execute("UPDATE price_items SET pack_unit = 'pack' WHERE pack_size IS NOT NULL")


def downgrade() -> None:
    with op.batch_alter_table("price_items") as batch:
        batch.drop_column("pack_unit")

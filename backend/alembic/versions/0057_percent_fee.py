"""percent_fee

Yüzdelik sabit ücret: kalemde "en az" tutar alanı (yüzde değeri fiyat sürümlerinde, birim "pct").

Revision ID: 0057
Revises: 0056
Create Date: 2026-10-20 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0057'
down_revision: Union[str, None] = '0056'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("price_items") as batch:
        batch.add_column(sa.Column("min_amount", sa.Numeric(14, 4), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("price_items") as batch:
        batch.drop_column("min_amount")

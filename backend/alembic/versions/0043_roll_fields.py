"""roll_fields

Fiyat kalemine rulo bilgisi: rulo eni, film kalınlığı ve rulo boyu. Kg ya da adet fiyatlı sarf kalemi (streç, bant) metre cinsinden
hesaplanabilsin diye. Yalnızca nullable sütunlar eklenir.

Revision ID: 0043
Revises: 0042
Create Date: 2026-10-10 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0043'
down_revision: Union[str, None] = '0042'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("price_items", sa.Column("roll_width", sa.Numeric(12, 2), nullable=True))
    op.add_column("price_items", sa.Column("film_um", sa.Numeric(10, 3), nullable=True))
    op.add_column("price_items", sa.Column("roll_length", sa.Numeric(12, 3), nullable=True))


def downgrade() -> None:
    op.drop_column("price_items", "roll_length")
    op.drop_column("price_items", "film_um")
    op.drop_column("price_items", "roll_width")

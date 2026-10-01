"""shipping reference cache (kalıcı: kargo/işlem/iade/bölüm/üretim ortağı listeleri)

Revision ID: c9e1a3b5d7f0
Revises: b8d0f2a4c6e9
Create Date: 2026-09-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c9e1a3b5d7f0'
down_revision: Union[str, None] = 'b8d0f2a4c6e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'shipping_reference_cache',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('kind', sa.String(length=64), nullable=False),
        sa.Column('data_json', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('shop_id', 'kind', name='uq_shipping_ref_cache_shop_kind'),
    )
    op.create_index('ix_shipping_reference_cache_shop_id', 'shipping_reference_cache', ['shop_id'])


def downgrade() -> None:
    op.drop_index('ix_shipping_reference_cache_shop_id', table_name='shipping_reference_cache')
    op.drop_table('shipping_reference_cache')

"""shipping invoices (fatura yükleme -> kargo/gümrük maliyeti çıkarımı)

Revision ID: e4a6c8b0d2f4
Revises: d2f4b6a8c0e3
Create Date: 2026-09-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e4a6c8b0d2f4'
down_revision: Union[str, None] = 'd2f4b6a8c0e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'shipping_invoices',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('variant_key', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('kind', sa.String(length=20), nullable=False, server_default='diğer'),
        sa.Column('amount', sa.Float(), nullable=False),
        sa.Column('original_amount', sa.Float(), nullable=False),
        sa.Column('original_currency', sa.String(length=10), nullable=False, server_default=''),
        sa.Column('fx_rate', sa.Float(), nullable=False, server_default='1'),
        sa.Column('fx_source', sa.String(length=20), nullable=False, server_default='fatura'),
        sa.Column('invoice_date', sa.Date(), nullable=False),
        sa.Column('weight_kg', sa.Float(), nullable=True),
        sa.Column('vendor', sa.String(length=120), nullable=False, server_default=''),
        sa.Column('source_filename', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('match_confidence', sa.Float(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_shipping_invoices_shop_id', 'shipping_invoices', ['shop_id'])
    op.create_index('ix_shipping_invoices_listing_id', 'shipping_invoices', ['listing_id'])


def downgrade() -> None:
    op.drop_index('ix_shipping_invoices_listing_id', table_name='shipping_invoices')
    op.drop_index('ix_shipping_invoices_shop_id', table_name='shipping_invoices')
    op.drop_table('shipping_invoices')

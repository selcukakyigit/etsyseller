"""shipping_invoices: sipariş bağlantısı + takip no (gönderi bazlı maliyet, çift girişi önleme)

Revision ID: f5b7d9e1a3c5
Revises: e4a6c8b0d2f4
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f5b7d9e1a3c5'
down_revision: Union[str, None] = 'e4a6c8b0d2f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shipping_invoices') as b:
        b.add_column(sa.Column('receipt_id', sa.Integer(), nullable=True))
        b.add_column(sa.Column('tracking_no', sa.String(length=40), nullable=False, server_default=''))
    op.create_index('ix_shipping_invoices_receipt_id', 'shipping_invoices', ['receipt_id'])
    op.create_index('ix_shipping_invoices_tracking_no', 'shipping_invoices', ['tracking_no'])


def downgrade() -> None:
    op.drop_index('ix_shipping_invoices_tracking_no', table_name='shipping_invoices')
    op.drop_index('ix_shipping_invoices_receipt_id', table_name='shipping_invoices')
    with op.batch_alter_table('shipping_invoices') as b:
        b.drop_column('tracking_no')
        b.drop_column('receipt_id')

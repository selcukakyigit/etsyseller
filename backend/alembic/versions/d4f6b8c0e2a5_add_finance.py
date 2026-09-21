"""add finance tables (ledger, payments, listing costs)

Revision ID: d4f6b8c0e2a5
Revises: c2e5a7b9d1f4
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd4f6b8c0e2a5'
down_revision: Union[str, None] = 'c2e5a7b9d1f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ledger_entries',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('entry_id', sa.Integer(), nullable=False),
        sa.Column('created_ts', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(10), nullable=False, server_default=''),
        sa.Column('ledger_type', sa.String(60), nullable=False),
        sa.Column('reference_type', sa.String(40), nullable=False, server_default=''),
        sa.Column('reference_id', sa.String(40), nullable=False, server_default=''),
        sa.Column('receipt_id', sa.Integer(), nullable=True),
        sa.UniqueConstraint('shop_id', 'entry_id', name='uq_ledger_shop_entry'),
    )
    op.create_index('ix_ledger_entries_shop_id', 'ledger_entries', ['shop_id'])
    op.create_index('ix_ledger_entries_created_ts', 'ledger_entries', ['created_ts'])
    op.create_index('ix_ledger_entries_ledger_type', 'ledger_entries', ['ledger_type'])
    op.create_index('ix_ledger_entries_receipt_id', 'ledger_entries', ['receipt_id'])
    op.create_table(
        'fin_payments',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('payment_id', sa.Integer(), nullable=False),
        sa.Column('receipt_id', sa.Integer(), nullable=False),
        sa.Column('gross_minor', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('fees_minor', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('currency', sa.String(10), nullable=False, server_default=''),
        sa.UniqueConstraint('shop_id', 'payment_id', name='uq_finpay_shop_payment'),
    )
    op.create_index('ix_fin_payments_shop_id', 'fin_payments', ['shop_id'])
    op.create_index('ix_fin_payments_receipt_id', 'fin_payments', ['receipt_id'])
    op.create_table(
        'listing_costs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('unit_cost', sa.Float(), nullable=False, server_default='0'),
        sa.Column('shipping_cost', sa.Float(), nullable=False, server_default='0'),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('shop_id', 'listing_id', name='uq_listing_cost'),
    )
    op.create_index('ix_listing_costs_shop_id', 'listing_costs', ['shop_id'])


def downgrade() -> None:
    op.drop_table('listing_costs')
    op.drop_table('fin_payments')
    op.drop_table('ledger_entries')

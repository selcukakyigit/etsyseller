"""content hash on stat snapshots and ad reports

Revision ID: b8d0f2a4c6e9
Revises: a7c9e1f3b5d8
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b8d0f2a4c6e9'
down_revision: Union[str, None] = 'a7c9e1f3b5d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('listing_stat_snapshots') as batch:
        batch.add_column(sa.Column('content_hash', sa.String(16), nullable=True))
    op.create_table(
        'ad_reports',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.Integer(), nullable=True),
        sa.Column('listing_title', sa.String(255), nullable=False, server_default=''),
        sa.Column('period_start', sa.Date(), nullable=True),
        sa.Column('period_end', sa.Date(), nullable=True),
        sa.Column('spend', sa.Float(), nullable=False, server_default='0'),
        sa.Column('views', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('clicks', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('orders', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('revenue', sa.Float(), nullable=False, server_default='0'),
        sa.Column('keywords_json', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('note', sa.String(500), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_ad_reports_shop_id', 'ad_reports', ['shop_id'])
    op.create_index('ix_ad_reports_listing_id', 'ad_reports', ['listing_id'])


def downgrade() -> None:
    op.drop_table('ad_reports')
    with op.batch_alter_table('listing_stat_snapshots') as batch:
        batch.drop_column('content_hash')

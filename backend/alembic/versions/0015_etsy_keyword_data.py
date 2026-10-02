"""etsy keyword data

Kullanıcının Etsy panelinden yapıştırdığı arama verisi (Marketplace Insights, arama terimleri, Etsy Ads).

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-02 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0015'
down_revision: Union[str, None] = '0014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'etsy_keyword_data',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.BigInteger(), nullable=True),
        sa.Column('keyword', sa.String(length=100), nullable=False),
        sa.Column('source', sa.String(length=30), nullable=False),
        sa.Column('searches', sa.Integer(), nullable=True),
        sa.Column('competition', sa.String(length=20), nullable=True),
        sa.Column('listings_count', sa.Integer(), nullable=True),
        sa.Column('views', sa.Integer(), nullable=True),
        sa.Column('clicks', sa.Integer(), nullable=True),
        sa.Column('orders', sa.Integer(), nullable=True),
        sa.Column('period_start', sa.Date(), nullable=True),
        sa.Column('period_end', sa.Date(), nullable=True),
        sa.Column('captured_on', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_etsy_keyword_data_shop_id', 'etsy_keyword_data', ['shop_id'])
    op.create_index('ix_etsy_keyword_data_listing_id', 'etsy_keyword_data', ['listing_id'])
    op.create_index('ix_etsy_keyword_data_keyword', 'etsy_keyword_data', ['keyword'])


def downgrade() -> None:
    op.drop_table('etsy_keyword_data')

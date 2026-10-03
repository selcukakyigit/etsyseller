"""notifications

Etsy webhook'larından gelen sipariş olayları için bildirim tablosu ve kullanıcının "yeni siparişte e-posta" tercihi
(varsayılan kapalı: Etsy zaten satıcıya satış e-postası gönderiyor). `email_lang` tercih kaydedilirken arayüz dilinden
alınır; arka plandaki e-posta isteğin dilini bilemez. `order_cache.delivered_at`: Etsy makbuzunda teslim tarihi
olmadığı için order.delivered webhook'unun zamanı.

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-03 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0020'
down_revision: Union[str, None] = '0019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(length=30), nullable=False),
        sa.Column('receipt_id', sa.BigInteger(), nullable=True),
        sa.Column('data_json', sa.Text(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint('shop_id', 'kind', 'receipt_id', name='uq_notifications_shop_kind_receipt'),
    )
    op.create_index('ix_notifications_shop_id', 'notifications', ['shop_id'])
    op.create_index('ix_notifications_created_at', 'notifications', ['created_at'])
    op.add_column('order_cache', sa.Column('delivered_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('notify_order_email', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('email_lang', sa.String(length=2), nullable=False, server_default='en'))


def downgrade() -> None:
    op.drop_column('users', 'email_lang')
    op.drop_column('users', 'notify_order_email')
    op.drop_column('order_cache', 'delivered_at')
    op.drop_index('ix_notifications_created_at', table_name='notifications')
    op.drop_index('ix_notifications_shop_id', table_name='notifications')
    op.drop_table('notifications')

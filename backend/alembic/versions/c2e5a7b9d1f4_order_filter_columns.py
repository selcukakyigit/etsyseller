"""add derived filter columns to order cache

Revision ID: c2e5a7b9d1f4
Revises: b1d4f6a8c2e3
Create Date: 2026-09-21 00:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c2e5a7b9d1f4'
down_revision: Union[str, None] = 'b1d4f6a8c2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('order_cache') as batch:
        batch.add_column(sa.Column('country_iso', sa.String(2), nullable=False, server_default=''))
        batch.add_column(sa.Column('channel', sa.String(10), nullable=False, server_default='etsy'))
        batch.add_column(sa.Column('is_gift', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('has_note', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('has_personalization', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('has_upgrade', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('is_canceled', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('search_text', sa.Text(), nullable=False, server_default=''))
        batch.create_index('ix_order_cache_country_iso', ['country_iso'])
        batch.create_index('ix_order_cache_is_canceled', ['is_canceled'])

    # Var olan siparişleri raw_json'dan doldur
    from app.orders.derive import derive

    conn = op.get_bind()
    rows = conn.execute(sa.text('SELECT id, raw_json FROM order_cache')).fetchall()
    for row_id, raw in rows:
        d = derive(json.loads(raw))
        conn.execute(
            sa.text(
                'UPDATE order_cache SET country_iso=:country_iso, channel=:channel, is_gift=:is_gift, has_note=:has_note, '
                'has_personalization=:has_personalization, has_upgrade=:has_upgrade, is_canceled=:is_canceled, search_text=:search_text '
                'WHERE id=:id'
            ),
            {**d, 'id': row_id},
        )


def downgrade() -> None:
    with op.batch_alter_table('order_cache') as batch:
        batch.drop_index('ix_order_cache_is_canceled')
        batch.drop_index('ix_order_cache_country_iso')
        for col in ('search_text', 'is_canceled', 'has_upgrade', 'has_personalization', 'has_note', 'is_gift', 'channel', 'country_iso'):
            batch.drop_column(col)

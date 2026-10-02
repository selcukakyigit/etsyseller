"""description templates

Hazır açıklama metinleri (mağaza başına; biri varsayılan olabilir).

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-02 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0012'
down_revision: Union[str, None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'description_templates',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('body', sa.Text(), nullable=False, server_default=''),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_description_templates_shop_id', 'description_templates', ['shop_id'])


def downgrade() -> None:
    op.drop_index('ix_description_templates_shop_id', table_name='description_templates')
    op.drop_table('description_templates')

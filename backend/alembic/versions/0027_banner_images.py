"""banner images

Mağaza banner oluşturucusunun ürettiği/kırptığı görseller (dosya blobstore'da; 30 gün sonra silinir).

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-05 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0027'
down_revision: Union[str, None] = '0026'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'banner_images',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('style', sa.String(12), nullable=False),
        sa.Column('slot', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('width', sa.Integer(), nullable=False),
        sa.Column('height', sa.Integer(), nullable=False),
        sa.Column('path', sa.String(500), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_banner_images_shop_id', 'banner_images', ['shop_id'])
    op.create_index('ix_banner_images_created_at', 'banner_images', ['created_at'])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.banner_images ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index('ix_banner_images_created_at', 'banner_images')
    op.drop_index('ix_banner_images_shop_id', 'banner_images')
    op.drop_table('banner_images')

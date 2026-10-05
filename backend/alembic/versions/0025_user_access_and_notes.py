"""user access and admin notes

Yönetim panelinde kullanıcı işlemleri: hesap durumu (aktif / askıda / engelli), panelden verilen rol (user / admin),
son aktif zamanı ve yöneticinin kullanıcı hakkındaki notları. users tablosuna sütun eklenmedi: göç uygulanmadan kod
yayına çıkarsa User okuyan her sorgu çökmesin; satırı olmayan kullanıcı "aktif, user" sayılır.

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-05 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0025'
down_revision: Union[str, None] = '0024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_access',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('status', sa.String(12), nullable=False, server_default='active'),
        sa.Column('role', sa.String(12), nullable=False, server_default='user'),
        sa.Column('status_reason', sa.String(300), nullable=True),
        sa.Column('status_changed_at', sa.DateTime(), nullable=True),
        sa.Column('last_seen_at', sa.DateTime(), nullable=True),
    )
    op.create_table(
        'admin_user_notes',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=False),
        sa.Column('author_email', sa.String(255), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_admin_user_notes_user_id', 'admin_user_notes', ['user_id'])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.admin_user_notes ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index('ix_admin_user_notes_user_id', 'admin_user_notes')
    op.drop_table('admin_user_notes')
    op.drop_table('user_access')

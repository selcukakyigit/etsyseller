"""add assistant chat tables

Revision ID: a7c9e1f3b5d8
Revises: f6b8d0e2a4c7
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a7c9e1f3b5d8'
down_revision: Union[str, None] = 'f6b8d0e2a4c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'chat_sessions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(120), nullable=False, server_default='Yeni sohbet'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_chat_sessions_shop_id', 'chat_sessions', ['shop_id'])
    op.create_index('ix_chat_sessions_user_id', 'chat_sessions', ['user_id'])
    op.create_index('ix_chat_sessions_updated_at', 'chat_sessions', ['updated_at'])
    op.create_table(
        'chat_messages',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('chat_sessions.id'), nullable=False),
        sa.Column('role', sa.String(12), nullable=False),
        sa.Column('content', sa.Text(), nullable=False, server_default=''),
        sa.Column('image_ids_json', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('cards_json', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_chat_messages_session_id', 'chat_messages', ['session_id'])
    op.create_table(
        'chat_images',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=True),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('content_type', sa.String(80), nullable=False),
        sa.Column('path', sa.String(500), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_chat_images_shop_id', 'chat_images', ['shop_id'])
    op.create_index('ix_chat_images_session_id', 'chat_images', ['session_id'])


def downgrade() -> None:
    op.drop_table('chat_images')
    op.drop_table('chat_messages')
    op.drop_table('chat_sessions')

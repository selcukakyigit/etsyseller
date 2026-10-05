"""assistant memory, usage and tool notes

Asistan bağlamı: mağaza notları (sohbetler arası hafıza), istek başına token kullanımı (maliyet izleme) ve asistan
mesajlarında araç sonuçlarının kısa özeti (sohbet içinde konuşulan kimlikleri ve rakamları unutmamak için).

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-05 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0023'
down_revision: Union[str, None] = '0022'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chat_messages', sa.Column('tool_notes', sa.Text(), nullable=True))
    op.create_table(
        'assistant_memories',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('text', sa.String(300), nullable=False),
        sa.Column('source', sa.String(12), nullable=False, server_default='assistant'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_assistant_memories_shop_id', 'assistant_memories', ['shop_id'])
    op.create_table(
        'assistant_usage',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=True),
        sa.Column('provider', sa.String(20), nullable=False),
        sa.Column('model', sa.String(80), nullable=False),
        sa.Column('rounds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('input_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cached_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cache_write_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('output_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('tools', sa.String(500), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_assistant_usage_shop_id', 'assistant_usage', ['shop_id'])
    op.create_index('ix_assistant_usage_created_at', 'assistant_usage', ['created_at'])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.assistant_memories ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index('ix_assistant_usage_created_at', 'assistant_usage')
    op.drop_index('ix_assistant_usage_shop_id', 'assistant_usage')
    op.drop_table('assistant_usage')
    op.drop_index('ix_assistant_memories_shop_id', 'assistant_memories')
    op.drop_table('assistant_memories')
    op.drop_column('chat_messages', 'tool_notes')

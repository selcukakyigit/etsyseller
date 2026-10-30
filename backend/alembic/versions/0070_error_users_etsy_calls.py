"""error group affected users, persistent Etsy call counter

`support_error_users`: hata grubundan etkilenen kullanıcılar (grup başına bir satır; hesap silinince gider). `etsy_call_daily`: Etsy API çağrı sayacının
günlük toplamı (bellek sayacı periyodik olarak buraya eklenir; yeniden başlatma ve birden çok süreç toplamı bozmaz). İkisi de küresel yönetim
tabloları: `workspace_id` yok, RLS açık, politikasız (yalnızca sistem yazar).

Revision ID: 0070
Revises: 0069
Create Date: 2026-10-30 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0070'
down_revision: Union[str, None] = '0069'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("support_error_users", "etsy_call_daily")


def upgrade() -> None:
    op.create_table(
        "support_error_users",
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("support_error_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True),
        sa.Column("first_seen", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "etsy_call_daily",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("n", sa.BigInteger(), nullable=False, server_default="0"),
    )
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        for table in TABLES:
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)

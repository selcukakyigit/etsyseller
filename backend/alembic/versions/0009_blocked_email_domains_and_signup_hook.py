"""blocked email domains and signup hook

Tek kullanımlık e-posta alan adları tablosu + Supabase "Before User Created" kancası olarak kullanılan Postgres fonksiyonu.
Kanca Supabase panelinden etkinleştirilir: Authentication > Hooks > Before User Created > Postgres >
public.hook_block_disposable_email.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-01 17:16:28.807396

"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LIST_FILE = Path(__file__).resolve().parents[2] / "app" / "auth" / "disposable_domains.txt"


def upgrade() -> None:
    op.create_table('blocked_email_domains',
    sa.Column('domain', sa.String(length=255), nullable=False),
    sa.PrimaryKeyConstraint('domain')
    )
    # Diğer tablolar gibi PostgREST'e kapalı (politika yok). Kanca SECURITY DEFINER olduğu için tabloyu yine okuyabilir.
    op.execute("ALTER TABLE public.blocked_email_domains ENABLE ROW LEVEL SECURITY")

    domains = [line.strip() for line in LIST_FILE.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]
    table = sa.table("blocked_email_domains", sa.column("domain", sa.String))
    op.bulk_insert(table, [{"domain": d} for d in domains])

    op.execute(
        """
        create or replace function public.hook_block_disposable_email(event jsonb)
        returns jsonb
        language plpgsql
        security definer
        set search_path = ''
        as $$
        declare
          email_domain text := lower(split_part(coalesce(event->'user'->>'email', ''), '@', 2));
        begin
          if email_domain <> '' and exists (
            select 1 from public.blocked_email_domains b
            where b.domain = email_domain or email_domain like '%.' || b.domain
          ) then
            return jsonb_build_object('error', jsonb_build_object(
              'http_code', 400,
              'message', 'Disposable email addresses can''t be used. / Tek kullanımlık e-posta adresleriyle kayıt olunamaz.'
            ));
          end if;
          return '{}'::jsonb;
        end;
        $$;
        """
    )
    op.execute("grant execute on function public.hook_block_disposable_email(jsonb) to supabase_auth_admin")
    op.execute("revoke execute on function public.hook_block_disposable_email(jsonb) from authenticated, anon, public")


def downgrade() -> None:
    op.execute("drop function if exists public.hook_block_disposable_email(jsonb)")
    op.drop_table('blocked_email_domains')

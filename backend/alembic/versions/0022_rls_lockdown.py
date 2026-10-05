"""rls lockdown

Baseline (0001) yalnızca o gün var olan tabloların RLS'sini açmıştı; sonradan eklenen tablolar (description_templates,
tracked_keywords, rank_snapshots, etsy_keyword_data, demand_trends, listing_changes, notifications) RLS'siz kaldı ve
Supabase'in anon/authenticated rolleri bunlara PostgREST üzerinden (ön yüzdeki publishable key ile) erişebiliyordu.
Bu göç public şemadaki tüm tabloları yeniden kilitler (politika yok = anon/authenticated erişemez; backend tablo sahibi
postgres rolüyle bağlandığı için etkilenmez) ve alembic_version'daki yetkileri kaldırır.
Yeni tablo ekleyen her göç kendi tablosu için RLS'yi açmalı; açılmazsa sunucu açılışta hata kaydı düşer (core/db_guard.py).

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-05 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0022'
down_revision: Union[str, None] = '0021'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        """
        DO $$
        DECLARE t record;
        BEGIN
            FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version' AND NOT rowsecurity
            LOOP
                EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
            END LOOP;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                EXECUTE 'REVOKE ALL ON public.alembic_version FROM anon, authenticated';
            END IF;
            -- Tablo sahibi (göçleri çalıştıran rol) RLS'den etkilenmez; yalnızca Supabase Advisor uyarısı kapanır.
            EXECUTE 'ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY';
        END $$;
        """
    )


def downgrade() -> None:
    # Güvenlik düzeltmesi geri alınmaz.
    pass

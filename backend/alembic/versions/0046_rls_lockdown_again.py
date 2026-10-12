"""rls lockdown again

0029-0045 ile eklenen bazı tablolar (supply_product_packages, supply_product_paints, cost_versions, product_measures,
supply_package_lines, supply_package_types) RLS'siz kaldı. 0022 gibi, RLS'si kapalı tüm public tabloları kilitler.

Revision ID: 0046
Revises: 0045
Create Date: 2026-10-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0046'
down_revision: Union[str, None] = '0045'
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
        END $$;
        """
    )


def downgrade() -> None:
    # Güvenlik düzeltmesi geri alınmaz.
    pass

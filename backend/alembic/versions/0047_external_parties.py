"""external_parties

Maliyetin kendi mağazalarına yazılmayan payı için "dış pay sahipleri" (başka hesaptaki mağaza, yerel satış, ortak…) ve dağıtım satırının
bu sahibe bağlanabilmesi (shop_id boş olabilir, party_id eklenir).

Revision ID: 0047
Revises: 0046
Create Date: 2026-10-12 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0047'
down_revision: Union[str, None] = '0046'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "external_parties",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "name", name="uq_external_parties_workspace_name"),
    )
    op.create_index("ix_external_parties_workspace_id", "external_parties", ["workspace_id"])
    op.alter_column("supply_allocations", "shop_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("supply_allocations", sa.Column("party_id", sa.Integer(), sa.ForeignKey("external_parties.id", ondelete="RESTRICT"), nullable=True))
    op.create_index("ix_supply_allocations_party_id", "supply_allocations", ["party_id"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.external_parties ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_supply_allocations_party_id", table_name="supply_allocations")
    op.drop_column("supply_allocations", "party_id")
    op.alter_column("supply_allocations", "shop_id", existing_type=sa.Integer(), nullable=False)
    op.drop_index("ix_external_parties_workspace_id", table_name="external_parties")
    op.drop_table("external_parties")

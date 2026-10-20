"""material_types

Kullanıcının eklediği malzeme türleri (çalışma alanı seviyesinde).

Revision ID: 0055
Revises: 0054
Create Date: 2026-10-20 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0055'
down_revision: Union[str, None] = '0054'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "material_types",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("group", sa.String(8), nullable=False),
        sa.Column("density", sa.Numeric(8, 3), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "name", name="uq_material_types_workspace_name"),
    )
    op.create_index("ix_material_types_workspace_id", "material_types", ["workspace_id"])
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.material_types ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_material_types_workspace_id", table_name="material_types")
    op.drop_table("material_types")

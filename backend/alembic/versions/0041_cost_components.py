"""cost components

Birim maliyet bileşenlerden oluşur: her kaynak (tedarikçi kaydı, ambalaj…) kendi bileşenini yazar, maliyet bileşenlerin toplamıdır.
Mevcut sürümler bileşene atanır: tedarikçi sürümleri o tedarikçi kaydının bileşeni, "baseline" sürümleri "base" bileşeni olur.

Revision ID: 0041
Revises: 0040
Create Date: 2026-10-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0041'
down_revision: Union[str, None] = '0040'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("cost_versions", sa.Column("component", sa.String(40), nullable=False, server_default=""))
    op.add_column("cost_versions", sa.Column("label", sa.String(120), nullable=False, server_default=""))
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE cost_versions SET component = 'base', label = 'Önceki maliyet' WHERE source = 'baseline'"))
    rows = bind.execute(sa.text(
        "SELECT v.id, e.id AS entity_id, e.name, e.label FROM cost_versions v "
        "JOIN supply_allocations a ON v.ref = 'supply:' || CAST(a.id AS VARCHAR) "
        "JOIN supply_jobs j ON j.id = a.job_id JOIN module_entities e ON e.id = j.entity_id WHERE v.source = 'supply'"
    )).mappings().all()
    for r in rows:
        bind.execute(sa.text("UPDATE cost_versions SET component = :c, label = :l WHERE id = :id"),
                     {"c": f"supply:{r['entity_id']}", "l": " · ".join(x for x in (r["label"], r["name"]) if x)[:120], "id": r["id"]})


def downgrade() -> None:
    op.drop_column("cost_versions", "label")
    op.drop_column("cost_versions", "component")

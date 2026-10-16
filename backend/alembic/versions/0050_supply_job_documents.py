"""supply_job_documents

Bir işe birden çok belge bağlanabilsin (ör. her plakanın üretim raporu): işin tek `document_id` sütunu yerine bağ tablosu. Var olan işlerin belgesi
tabloya taşınır, sütun kaldırılır.

Revision ID: 0050
Revises: 0049
Create Date: 2026-10-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0050'
down_revision: Union[str, None] = '0049'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "supply_job_documents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("supply_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("entity_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("job_id", "document_id", name="uq_supply_job_documents_job_document"),
    )
    op.create_index("ix_supply_job_documents_job_id", "supply_job_documents", ["job_id"])
    op.create_index("ix_supply_job_documents_document_id", "supply_job_documents", ["document_id"])
    op.execute("INSERT INTO supply_job_documents (job_id, document_id, position) SELECT id, document_id, 0 FROM supply_jobs WHERE document_id IS NOT NULL")
    with op.batch_alter_table("supply_jobs") as batch:
        batch.drop_column("document_id")
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.supply_job_documents ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("supply_jobs") as batch:
        batch.add_column(sa.Column("document_id", sa.Integer(), sa.ForeignKey("entity_documents.id", ondelete="SET NULL", name="fk_supply_jobs_document_id"), nullable=True))
    op.execute(
        "UPDATE supply_jobs SET document_id = (SELECT d.document_id FROM supply_job_documents d WHERE d.job_id = supply_jobs.id ORDER BY d.position, d.id LIMIT 1)"
    )
    op.drop_index("ix_supply_job_documents_document_id", table_name="supply_job_documents")
    op.drop_index("ix_supply_job_documents_job_id", table_name="supply_job_documents")
    op.drop_table("supply_job_documents")

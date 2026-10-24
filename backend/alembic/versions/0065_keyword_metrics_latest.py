"""keyword metrics latest flag

Yönetim kelime listesi her kelimenin güncel ölçümünü `is_latest` ile bulur (tüm ölçüm geçmişini gruplamadan). Mevcut satırlar geriye dönük işaretlenir:
(kelime, pazar, dil) başına en yeni ölçüm (aynı anda ise en büyük id) `true`, diğerleri `false`. Postgres'te kelime araması (`LIKE '%…%'`) için trigram dizini.

Revision ID: 0065
Revises: 0064
Create Date: 2026-10-24 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0065'
down_revision: Union[str, None] = '0064'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("keyword_metrics", sa.Column("is_latest", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.execute(
        """
        UPDATE keyword_metrics SET is_latest = false
        WHERE EXISTS (
            SELECT 1 FROM keyword_metrics n
            WHERE n.keyword_id = keyword_metrics.keyword_id AND n.market = keyword_metrics.market AND n.language = keyword_metrics.language
              AND (n.measured_at > keyword_metrics.measured_at OR (n.measured_at = keyword_metrics.measured_at AND n.id > keyword_metrics.id))
        )
        """
    )
    op.create_index(
        "ix_keyword_metrics_latest", "keyword_metrics", ["market", "language", "keyword_id"],
        postgresql_where=sa.text("is_latest"), sqlite_where=sa.text("is_latest"),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        op.execute("CREATE INDEX ix_keyword_terms_term_trgm ON keyword_terms USING gin (term gin_trgm_ops)")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_keyword_terms_term_trgm")
    op.drop_index("ix_keyword_metrics_latest", table_name="keyword_metrics")
    op.drop_column("keyword_metrics", "is_latest")

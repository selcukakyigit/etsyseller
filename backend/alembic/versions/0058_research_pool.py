"""research pool

Ortak araştırma havuzu: kelimeler, tarihli ölçümler, ilişkiler, iş kuyruğu, sağlayıcı çağrı günlüğü ve şifreli sağlayıcı anahtarı.
Bu tablolarda workspace_id yoktur (tüm mağazalar ortak okur, yalnızca sistem yazar); RLS açık ve politikasız: PostgREST'e kapalı.

Revision ID: 0058
Revises: 0057
Create Date: 2026-10-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0058'
down_revision: Union[str, None] = '0057'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ID = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
_TABLES = ("keyword_terms", "keyword_metrics", "keyword_links", "research_jobs", "provider_calls", "research_provider_keys")


def upgrade() -> None:
    op.create_table(
        "keyword_terms",
        sa.Column("id", _ID, primary_key=True, autoincrement=True),
        sa.Column("term", sa.String(120), nullable=False),
        sa.Column("display", sa.String(120), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("first_source", sa.String(30), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("term", "language", name="uq_keyword_terms_term_language"),
    )
    op.create_index("ix_keyword_terms_term", "keyword_terms", ["term"])
    op.create_index("ix_keyword_terms_last_used_at", "keyword_terms", ["last_used_at"])

    op.create_table(
        "keyword_metrics",
        sa.Column("id", _ID, primary_key=True, autoincrement=True),
        sa.Column("keyword_id", _ID, sa.ForeignKey("keyword_terms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("source", sa.String(30), nullable=False),
        sa.Column("market", sa.String(2), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("search_volume", sa.Integer(), nullable=True),
        sa.Column("cpc", sa.Numeric(14, 4), nullable=True),
        sa.Column("competition", sa.Float(), nullable=True),
        sa.Column("difficulty", sa.Integer(), nullable=True),
        sa.Column("intent", sa.String(20), nullable=True),
        sa.Column("monthly_json", sa.Text(), nullable=True),
        sa.Column("measured_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_keyword_metrics_lookup", "keyword_metrics", ["keyword_id", "market", "language", "measured_at"])
    op.create_index("ix_keyword_metrics_expires_at", "keyword_metrics", ["expires_at"])

    op.create_table(
        "keyword_links",
        sa.Column("seed_id", _ID, sa.ForeignKey("keyword_terms.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("keyword_id", _ID, sa.ForeignKey("keyword_terms.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("relation", sa.String(20), primary_key=True, server_default="suggestion"),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("observed_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_keyword_links_keyword_id", "keyword_links", ["keyword_id"])

    op.create_table(
        "research_jobs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("market", sa.String(2), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("idem_key", sa.String(200), nullable=False),
        sa.Column("params_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(12), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="SET NULL"), nullable=True),
        sa.Column("run_after", sa.DateTime(), nullable=False),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_research_jobs_shop_id", "research_jobs", ["shop_id"])
    op.create_index("ix_research_jobs_status_run", "research_jobs", ["status", "run_after"])
    op.create_index(
        "uq_research_jobs_active_key", "research_jobs", ["idem_key"], unique=True,
        postgresql_where=sa.text("status IN ('queued','running')"), sqlite_where=sa.text("status IN ('queued','running')"),
    )

    op.create_table(
        "provider_calls",
        sa.Column("id", _ID, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("research_jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("endpoint", sa.String(80), nullable=False),
        sa.Column("market", sa.String(2), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("error", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_provider_calls_job_id", "provider_calls", ["job_id"])
    op.create_index("ix_provider_calls_created_at", "provider_calls", ["created_at"])

    op.create_table(
        "research_provider_keys",
        sa.Column("provider", sa.String(20), primary_key=True),
        sa.Column("login", sa.String(200), nullable=False),
        sa.Column("password", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        for table in _TABLES:
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_table(table)

"""modules and supply

Modül çekirdeği (module_entities ve ona bağlı ortak tablolar: fiyat listesi, belgeler, analiz önbelleği, alan
eşlemeleri, davetler, erişimler, kayıt akışı) ve Dış Tedarik (işler, satırlar, dağıtımlar).

Yalnızca yeni tablolar eklenir (eski koda dokunmaz). Bütün bağlar gerçek yabancı anahtardır: bir kayıt silinince
bağlı satırlar zincirleme silinir; kullanıcı silinince "kim yaptı" alanları boşa düşer.

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0029'
down_revision: Union[str, None] = '0028'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(14, 4, asdecimal=False)
PCT = sa.Numeric(8, 4, asdecimal=False)
FX = sa.Numeric(18, 8, asdecimal=False)


def _user_fk(name: str) -> sa.Column:
    return sa.Column(name, sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


def _entity_fk() -> sa.Column:
    return sa.Column("entity_id", sa.Integer(), sa.ForeignKey("module_entities.id", ondelete="CASCADE"), nullable=False)


def upgrade() -> None:
    op.create_table(
        "module_entities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module", sa.String(30), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("label", sa.String(60), nullable=False, server_default=""),
        sa.Column("currency", sa.String(3), nullable=False, server_default="TRY"),
        sa.Column("vat_rate", PCT, nullable=False, server_default="0"),
        sa.Column("vat_in_cost", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("contact_email", sa.String(255), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("image_path", sa.String(500), nullable=False, server_default=""),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        _user_fk("created_by"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_module_entities_ws_module", "module_entities", ["workspace_id", "module"])

    op.create_table(
        "price_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        _entity_fk(),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("unit", sa.String(10), nullable=False),
        sa.Column("spec", sa.String(200), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_price_items_entity_id", "price_items", ["entity_id"])

    op.create_table(
        "price_versions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("price_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("price", MONEY, nullable=False),
        sa.Column("valid_from", sa.DateTime(), nullable=False),
        sa.Column("source", sa.String(8), nullable=False, server_default="owner"),
        _user_fk("created_by"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_price_versions_item_from", "price_versions", ["item_id", "valid_from"])

    op.create_table(
        "entity_documents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        _entity_fk(),
        _user_fk("uploaded_by"),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False, server_default=""),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("path", sa.String(500), nullable=False, server_default=""),
        sa.Column("profile", sa.String(40), nullable=False),
        sa.Column("extracted_json", sa.Text(), nullable=True),
        sa.Column("extract_source", sa.String(12), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_entity_documents_entity_id", "entity_documents", ["entity_id"])
    op.create_index("ix_entity_documents_sha256", "entity_documents", ["sha256"])
    op.create_index("ix_entity_documents_created_at", "entity_documents", ["created_at"])

    op.create_table(
        "analyzer_cache",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("profile", sa.String(40), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("source", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "profile", "sha256", name="uq_analyzer_cache_ws_profile_sha"),
    )
    op.create_index("ix_analyzer_cache_workspace_id", "analyzer_cache", ["workspace_id"])

    op.create_table(
        "field_mappings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        _entity_fk(),
        sa.Column("profile", sa.String(40), nullable=False),
        sa.Column("field_key", sa.String(120), nullable=False),
        sa.Column("price_item_id", sa.Integer(), sa.ForeignKey("price_items.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("entity_id", "profile", "field_key", name="uq_field_mappings_entity_profile_key"),
    )
    op.create_index("ix_field_mappings_entity_id", "field_mappings", ["entity_id"])

    op.create_table(
        "share_invites",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        _entity_fk(),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("permissions", sa.String(200), nullable=False, server_default=""),
        _user_fk("invited_by"),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        _user_fk("accepted_by"),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("last_sent_at", sa.DateTime(), nullable=True),
        sa.Column("send_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_share_invites_token_hash"),
    )
    op.create_index("ix_share_invites_entity_id", "share_invites", ["entity_id"])

    op.create_table(
        "share_grants",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        _entity_fk(),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permissions", sa.String(200), nullable=False, server_default=""),
        _user_fk("granted_by"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("entity_id", "user_id", name="uq_share_grants_entity_user"),
    )
    op.create_index("ix_share_grants_entity_id", "share_grants", ["entity_id"])
    op.create_index("ix_share_grants_user_id", "share_grants", ["user_id"])

    op.create_table(
        "entity_activity",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        _entity_fk(),
        _user_fk("actor_id"),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("data_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("internal", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_entity_activity_entity_id", "entity_activity", ["entity_id"])
    op.create_index("ix_entity_activity_created_at", "entity_activity", ["created_at"])

    op.create_table(
        "supply_jobs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        _entity_fk(),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column("job_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="draft"),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("vat_rate", PCT, nullable=False, server_default="0"),
        sa.Column("estimate", MONEY, nullable=False, server_default="0"),
        sa.Column("actual", MONEY, nullable=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("dispute_note", sa.String(500), nullable=False, server_default=""),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("entity_documents.id", ondelete="SET NULL"), nullable=True),
        sa.Column("allocation_plan", sa.Text(), nullable=False, server_default="[]"),
        _user_fk("created_by"),
        sa.Column("created_via", sa.String(8), nullable=False, server_default="owner"),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        _user_fk("confirmed_by"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("entity_id", "number", name="uq_supply_jobs_entity_number"),
    )
    op.create_index("ix_supply_jobs_entity_id", "supply_jobs", ["entity_id"])

    op.create_table(
        "supply_job_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("supply_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("price_item_id", sa.Integer(), sa.ForeignKey("price_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("description", sa.String(200), nullable=False, server_default=""),
        sa.Column("qty", sa.Numeric(18, 6, asdecimal=False), nullable=False, server_default="1"),
        sa.Column("unit", sa.String(10), nullable=False, server_default="piece"),
        sa.Column("unit_price", MONEY, nullable=False, server_default="0"),
        sa.Column("manual_price", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("amount", MONEY, nullable=False, server_default="0"),
        sa.Column("source_key", sa.String(120), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_supply_job_lines_job_id", "supply_job_lines", ["job_id"])
    op.create_index("ix_supply_job_lines_price_item_id", "supply_job_lines", ["price_item_id"])

    op.create_table(
        "supply_allocations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("supply_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("listing_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column("qty", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("amount_report", MONEY, nullable=False),
        sa.Column("report_ccy", sa.String(10), nullable=False),
        sa.Column("fx_rate", FX, nullable=False, server_default="1"),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_supply_allocations_job_id", "supply_allocations", ["job_id"])
    op.create_index("ix_supply_allocations_shop_id", "supply_allocations", ["shop_id"])

    # Bu proje tablolarında RLS açık tutulur (Supabase'in herkese açık API'si üzerinden erişim kapalı; uygulama
    # sunucu tarafında doğrudan bağlanır). Bkz. core/db_guard.py.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in ("module_entities", "price_items", "price_versions", "entity_documents", "analyzer_cache", "field_mappings",
                      "share_invites", "share_grants", "entity_activity", "supply_jobs", "supply_job_lines", "supply_allocations"):
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    for table in ("supply_allocations", "supply_job_lines", "supply_jobs", "entity_activity", "share_grants", "share_invites",
                  "field_mappings", "analyzer_cache", "entity_documents", "price_versions", "price_items", "module_entities"):
        op.drop_table(table)

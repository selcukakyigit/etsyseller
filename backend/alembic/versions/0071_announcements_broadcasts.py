"""announcements list, email broadcast history

`announcements`: uygulama içi duyurular (birden çok; aktif olanlar birlikte gösterilir). `email_broadcasts`: toplu hizmet e-postalarının taslağı, ilerlemesi ve
sonucu. Eski tek duyuru (`app_settings` "announcement") varsa listeye bir satır olarak aktarılır. Küresel yönetim tabloları: `workspace_id` yok,
RLS açık, politikasız (yalnızca sistem yazar).

Revision ID: 0071
Revises: 0070
Create Date: 2026-10-30 20:00:00.000000

"""
import datetime as dt
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0071'
down_revision: Union[str, None] = '0070'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("announcements", "email_broadcasts")


def upgrade() -> None:
    announcements = op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tone", sa.String(10), nullable=False, server_default="info"),
        sa.Column("text_tr", sa.String(400), nullable=False),
        sa.Column("text_en", sa.String(400), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "email_broadcasts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("subject_tr", sa.String(150), nullable=False, server_default=""),
        sa.Column("subject_en", sa.String(150), nullable=False, server_default=""),
        sa.Column("body_tr", sa.Text(), nullable=False, server_default=""),
        sa.Column("body_en", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(12), nullable=False, server_default="draft", index=True),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
    )
    # Eski tek duyuruyu listeye taşı (varsa ve metni doluysa).
    bind = op.get_bind()
    raw = bind.execute(sa.text("SELECT value_json FROM app_settings WHERE key = 'announcement'")).scalar()
    if raw:
        old = json.loads(raw)
        if isinstance(old, dict) and old.get("text_tr") and old.get("text_en"):
            ends = None
            if old.get("ends_at"):
                try:
                    parsed = dt.datetime.fromisoformat(str(old["ends_at"]).replace("Z", "+00:00"))
                    ends = parsed.astimezone(dt.timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
                except ValueError:
                    ends = None
            now = dt.datetime.utcnow()
            op.bulk_insert(announcements, [{
                "tone": old.get("tone") if old.get("tone") in ("info", "warning") else "info",
                "text_tr": str(old["text_tr"])[:400], "text_en": str(old["text_en"])[:400],
                "active": bool(old.get("active")), "ends_at": ends, "created_at": now, "updated_at": now,
            }])
        bind.execute(sa.text("DELETE FROM app_settings WHERE key = 'announcement'"))
    if bind.dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        for table in TABLES:
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)

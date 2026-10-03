"""listing changes

Etsy'ye giden her değişikliğin kaydı ve ölçüm sonucu (bkz. app/listings/models.py ListingChange, app/insights/impact.py).
Eski geçmiş korunur: listing_versions'taki uygulanmış (applied) satırlar buraya taşınır; aynı listing'in aynı gün
uygulanmış birden fazla satırı (AI önerisi + aynı yayının elle kaydı) tek değişiklik sayılır.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-03 12:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0017'
down_revision: Union[str, None] = '0016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'listing_changes',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('shop_id', sa.Integer(), sa.ForeignKey('shops.id'), nullable=False),
        sa.Column('listing_id', sa.BigInteger(), nullable=False),
        sa.Column('published_at', sa.DateTime(), nullable=False),
        sa.Column('source', sa.String(length=10), nullable=False, server_default='manual'),
        sa.Column('fields', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('details', sa.Text(), nullable=False, server_default='{}'),
        sa.Column('focus', sa.String(length=20), nullable=True),
        sa.Column('result_json', sa.Text(), nullable=True),
        sa.Column('measured_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_listing_changes_shop_id', 'listing_changes', ['shop_id'])
    op.create_index('ix_listing_changes_listing_id', 'listing_changes', ['listing_id'])
    op.create_index('ix_listing_changes_published_at', 'listing_changes', ['published_at'])

    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT shop_id, listing_id, kind, applied_at, original_title, suggested_title, original_tags, suggested_tags, "
        "original_description, suggested_description FROM listing_versions WHERE status = 'applied' AND applied_at IS NOT NULL "
        "ORDER BY applied_at"
    )).fetchall()
    merged: dict[tuple, dict] = {}
    for r in rows:
        key = (r.shop_id, r.listing_id, r.applied_at.date())
        old_tags, new_tags = json.loads(r.original_tags or "[]"), json.loads(r.suggested_tags or "[]")
        fields = []
        if (r.original_title or "") != (r.suggested_title or ""):
            fields.append("title")
        if [t.lower() for t in old_tags] != [t.lower() for t in new_tags]:
            fields.append("tags")
        if (r.original_description or "") != (r.suggested_description or ""):
            fields.append("description")
        m = merged.setdefault(key, {"at": r.applied_at, "source": "manual", "fields": [], "details": {}})
        if r.kind == "ai_suggestion":
            m["source"] = "ai"
        m["fields"] = sorted(set(m["fields"]) | set(fields))
        if "title" in fields:
            m["details"].setdefault("title_before", r.original_title)
            m["details"]["title_after"] = r.suggested_title
        if "tags" in fields:
            lo_old, lo_new = {t.lower() for t in old_tags}, {t.lower() for t in new_tags}
            m["details"]["tags_added"] = [t for t in new_tags if t.lower() not in lo_old]
            m["details"]["tags_removed"] = [t for t in old_tags if t.lower() not in lo_new]
    table = sa.table(
        'listing_changes',
        sa.column('shop_id', sa.Integer), sa.column('listing_id', sa.BigInteger), sa.column('published_at', sa.DateTime),
        sa.column('source', sa.String), sa.column('fields', sa.Text), sa.column('details', sa.Text),
    )
    data = [
        {"shop_id": k[0], "listing_id": k[1], "published_at": m["at"], "source": m["source"],
         "fields": json.dumps(m["fields"] or ["other"]), "details": json.dumps(m["details"], ensure_ascii=False)}
        for k, m in merged.items()
    ]

    # Günlük kayıtlarda başlık/etiket/açıklama parmak izinin değiştiği ama Ulagg'dan yayın olmayan günler: Etsy'de yapılmış
    # değişiklik (listings/changes.py detect_etsy_changes'in geriye dönük karşılığı).
    known: dict[tuple, list] = {}
    for k in merged:
        known.setdefault((k[0], k[1]), []).append(k[2])
    prev: tuple | None = None
    for shop_id, listing_id, captured_at, h in bind.execute(sa.text(
        "SELECT shop_id, listing_id, captured_at, content_hash FROM listing_stat_snapshots WHERE content_hash IS NOT NULL "
        "ORDER BY shop_id, listing_id, captured_at"
    )):
        if prev and prev[0] == shop_id and prev[1] == listing_id and prev[2] != h:
            day = captured_at.date()
            if not any(abs((day - d).days) <= 1 for d in known.get((shop_id, listing_id), [])):
                data.append({"shop_id": shop_id, "listing_id": listing_id, "published_at": captured_at, "source": "etsy",
                             "fields": json.dumps(["text"]), "details": "{}"})
        prev = (shop_id, listing_id, h)
    if data:
        op.bulk_insert(table, data)


def downgrade() -> None:
    op.drop_table('listing_changes')

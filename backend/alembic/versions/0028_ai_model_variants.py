"""ai model variants

Görsel/video modellerinin fiyatlanan seçenekleri (çözünürlük, taslak…): sağlayıcı birim maliyeti, isteğe bağlı sabit
kredi ve sağlayıcıya giden parametreler. Kredi defterine seçenek sütunu eklenir.

Veri: mevcut görsel/video modellerinin fiyatı (`unit_usd`) ve görsel çözünürlüğü (`options.image_size`) seçeneklere
taşınır; fiyatı bilinen Google modellerine 1K/2K/4K seçenekleri liste fiyatıyla açılır. Replicate'teki prunaai/p-video
kataloğa dört seçeneğiyle eklenir.

`ai_models.unit_usd` sütunu silinmez: göç deploy'dan önce uygulandığında eski kod onu okumaya devam ediyor. Kod artık
kullanmıyor; sonraki bir göçte kaldırılabilir.

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-06 12:00:00.000000

"""
import datetime as dt
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0028'
down_revision: Union[str, None] = '0027'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(14, 4, asdecimal=False)

# Google liste fiyatları, görsel başına USD (ai.google.dev/gemini-api/docs/pricing, 2026-10-06).
KNOWN_IMAGE_PRICES = {
    "gemini-3.1-flash-image-preview": {"1K": 0.067, "2K": 0.101, "4K": 0.151},
    "gemini-3-pro-image-preview": {"1K": 0.134, "2K": 0.134, "4K": 0.24},
}

# replicate.com/prunaai/p-video, video saniyesi başına USD (2026-10-06).
P_VIDEO = {
    "model_id": "prunaai/p-video",
    "label": "P-Video (Pruna)",
    "options": {"durations": [3, 5, 8, 10], "default_duration": 5},
    "variants": [
        ("720p", "720p", "720p", 0.02, {"resolution": "720p", "draft": False}, True),
        ("1080p", "1080p", "1080p", 0.04, {"resolution": "1080p", "draft": False}, False),
        ("720p-draft", "720p taslak", "720p draft", 0.005, {"resolution": "720p", "draft": True}, False),
        ("1080p-draft", "1080p taslak", "1080p draft", 0.01, {"resolution": "1080p", "draft": True}, False),
    ],
}

models = sa.table(
    'ai_models',
    sa.column('id', sa.Integer), sa.column('kind', sa.String), sa.column('provider', sa.String), sa.column('model_id', sa.String),
    sa.column('label', sa.String), sa.column('active', sa.Boolean), sa.column('unit_usd', MONEY), sa.column('options_json', sa.Text),
    sa.column('created_at', sa.DateTime), sa.column('updated_at', sa.DateTime),
)
variants = sa.table(
    'ai_model_variants',
    sa.column('model_id', sa.Integer), sa.column('key', sa.String), sa.column('label_tr', sa.String), sa.column('label_en', sa.String),
    sa.column('cost_usd', MONEY), sa.column('params_json', sa.Text), sa.column('is_default', sa.Boolean), sa.column('active', sa.Boolean),
    sa.column('sort', sa.Integer),
)


def _options(text):
    try:
        value = json.loads(text or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _variant(model_id, key, label_tr, label_en, cost, params, is_default, sort):
    return dict(
        model_id=model_id, key=key, label_tr=label_tr, label_en=label_en, cost_usd=cost, params_json=json.dumps(params),
        is_default=is_default, active=True, sort=sort,
    )


def _migrate_existing(conn) -> None:
    rows = conn.execute(sa.select(models.c.id, models.c.kind, models.c.provider, models.c.model_id, models.c.unit_usd, models.c.options_json)
                        .where(models.c.kind.in_(["image", "video"]))).all()
    for model_id, kind, provider, name, unit_usd, options_json in rows:
        options = _options(options_json)
        size = options.pop("image_size", None)
        known = KNOWN_IMAGE_PRICES.get(name) if provider == "google" and kind == "image" else None
        if known:
            current = size if size in known else "2K"
            new = [_variant(model_id, k, k, k, cost, {"image_size": k}, k == current, i) for i, (k, cost) in enumerate(known.items())]
        elif kind == "image":
            size = size or "2K"
            new = [_variant(model_id, size, size, size, unit_usd or 0, {"image_size": size} if provider == "google" else {}, True, 0)]
        else:
            new = [_variant(model_id, "default", "Standart", "Standard", unit_usd or 0, {}, True, 0)]
        op.bulk_insert(variants, new)
        conn.execute(models.update().where(models.c.id == model_id).values(options_json=json.dumps(options)))


def _add_p_video(conn) -> None:
    exists = conn.execute(sa.select(models.c.id).where(models.c.provider == "replicate", models.c.model_id == P_VIDEO["model_id"])).first()
    if exists:
        return
    now = dt.datetime.utcnow()
    model_id = conn.execute(
        models.insert().values(
            kind="video", provider="replicate", model_id=P_VIDEO["model_id"], label=P_VIDEO["label"], active=True,
            options_json=json.dumps(P_VIDEO["options"]), created_at=now, updated_at=now,
        ).returning(models.c.id)
    ).scalar_one()
    op.bulk_insert(variants, [_variant(model_id, *v, i) for i, v in enumerate(P_VIDEO["variants"])])


def upgrade() -> None:
    op.create_table(
        'ai_model_variants',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('model_id', sa.Integer(), sa.ForeignKey('ai_models.id', ondelete='CASCADE'), nullable=False),
        sa.Column('key', sa.String(40), nullable=False),
        sa.Column('label_tr', sa.String(80), nullable=False),
        sa.Column('label_en', sa.String(80), nullable=False),
        sa.Column('cost_usd', MONEY, nullable=False),
        sa.Column('credits', sa.Integer(), nullable=True),
        sa.Column('params_json', sa.Text(), nullable=False, server_default='{}'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('sort', sa.Integer(), nullable=False, server_default='0'),
        sa.UniqueConstraint('model_id', 'key', name='uq_ai_model_variants_model_key'),
    )
    op.create_index('ix_ai_model_variants_model_id', 'ai_model_variants', ['model_id'])
    op.add_column('credit_ledger', sa.Column('variant', sa.String(40), nullable=True))
    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        op.execute("ALTER TABLE public.ai_model_variants ENABLE ROW LEVEL SECURITY")

    conn = op.get_bind()
    _migrate_existing(conn)
    _add_p_video(conn)


def downgrade() -> None:
    conn = op.get_bind()
    # Varsayılan seçeneğin fiyatı ve çözünürlüğü modele geri yazılır.
    rows = conn.execute(sa.select(variants.c.model_id, variants.c.cost_usd, variants.c.params_json).where(variants.c.is_default)).all()
    for model_id, cost, params_json in rows:
        options = _options(conn.execute(sa.select(models.c.options_json).where(models.c.id == model_id)).scalar())
        size = _options(params_json).get("image_size")
        if size:
            options["image_size"] = size
        conn.execute(models.update().where(models.c.id == model_id).values(unit_usd=cost, options_json=json.dumps(options)))
    # Bu göçün eklediği p-video kaldırılır (video henüz hiçbir göreve atanamadığı için bağımlılığı yok).
    p_video = (models.c.provider == "replicate") & (models.c.model_id == P_VIDEO["model_id"])
    p_video_id = conn.execute(sa.select(models.c.id).where(p_video)).scalar()
    if p_video_id is not None:
        conn.execute(variants.delete().where(variants.c.model_id == p_video_id))
        conn.execute(models.delete().where(models.c.id == p_video_id))
    op.drop_column('credit_ledger', 'variant')
    op.drop_index('ix_ai_model_variants_model_id', 'ai_model_variants')
    op.drop_table('ai_model_variants')

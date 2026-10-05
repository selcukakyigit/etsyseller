"""ai catalog, credits and billing

Yönetim paneli 2–4. adımlar:
- AI model kataloğu (ai_models), görev → model atamaları (ai_task_models) ve şifreli sağlayıcı anahtarları
  (ai_provider_keys). Önceden .env'de duruyordu; Render'da dosya sistemi kalıcı olmadığı için panelden yapılan
  değişiklik deploy'da kayboluyordu. Tablolar boşken kod .env değerlerine düşer (bkz. app/ai/catalog.py).
- Kredi: çalışma alanı başına iki kova (aylık plan kredisi + satın alınan kredi; credit_balances) ve her hareketin
  defteri (credit_ledger).
- Lemon Squeezy: satılan plan/paketler (billing_products), abonelikler (subscriptions), gelen webhook kayıtları
  (billing_events).
- Panelden değişen genel ayarlar (app_settings) ve yöneticinin yaptığı değişikliklerin kaydı (admin_audit_log).

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-05 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0024'
down_revision: Union[str, None] = '0023'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(14, 4, asdecimal=False)
NEW_TABLES = (
    'ai_provider_keys', 'ai_models', 'ai_task_models', 'app_settings', 'credit_balances', 'credit_ledger', 'billing_products',
    'subscriptions', 'billing_events', 'admin_audit_log',
)


def upgrade() -> None:
    op.create_table(
        'ai_provider_keys',
        sa.Column('provider', sa.String(30), primary_key=True),
        sa.Column('api_key', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_table(
        'ai_models',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('kind', sa.String(10), nullable=False),
        sa.Column('provider', sa.String(30), nullable=False),
        sa.Column('model_id', sa.String(120), nullable=False),
        sa.Column('label', sa.String(120), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('input_usd_per_mtok', MONEY, nullable=True),
        sa.Column('output_usd_per_mtok', MONEY, nullable=True),
        sa.Column('unit_usd', MONEY, nullable=True),
        sa.Column('options_json', sa.Text(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('provider', 'model_id', name='uq_ai_models_provider_model'),
    )
    op.create_table(
        'ai_task_models',
        sa.Column('task', sa.String(30), primary_key=True),
        sa.Column('model_id', sa.Integer(), sa.ForeignKey('ai_models.id'), nullable=False),
    )
    op.create_table(
        'app_settings',
        sa.Column('key', sa.String(60), primary_key=True),
        sa.Column('value_json', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )

    # Bakiyeler workspaces'e sütun olarak eklenmedi: göç uygulanmadan kod yayına çıkarsa yalnızca kredi özellikleri
    # çalışmaz, Workspace okuyan her sorgu (giriş dahil) çökmez.
    op.create_table(
        'credit_balances',
        sa.Column('workspace_id', sa.Integer(), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('plan', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('purchased', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_table(
        'credit_ledger',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('workspace_id', sa.Integer(), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('bucket', sa.String(10), nullable=False),
        sa.Column('delta', sa.Integer(), nullable=False),
        sa.Column('credits', sa.Integer(), nullable=False),
        sa.Column('task', sa.String(30), nullable=True),
        sa.Column('model', sa.String(120), nullable=True),
        sa.Column('cost_usd', MONEY, nullable=True),
        sa.Column('input_tokens', sa.Integer(), nullable=True),
        sa.Column('output_tokens', sa.Integer(), nullable=True),
        sa.Column('units', sa.Integer(), nullable=True),
        sa.Column('ref', sa.String(120), nullable=True, unique=True),
        sa.Column('note', sa.String(300), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_credit_ledger_workspace_id', 'credit_ledger', ['workspace_id'])
    op.create_index('ix_credit_ledger_created_at', 'credit_ledger', ['created_at'])

    op.create_table(
        'billing_products',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('kind', sa.String(10), nullable=False),
        sa.Column('name_tr', sa.String(120), nullable=False),
        sa.Column('name_en', sa.String(120), nullable=False),
        sa.Column('variant_id', sa.String(40), nullable=False, unique=True),
        sa.Column('credits', sa.Integer(), nullable=False),
        sa.Column('price_cents', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False, server_default='USD'),
        sa.Column('interval', sa.String(10), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('sort', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_table(
        'subscriptions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('workspace_id', sa.Integer(), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('lemon_subscription_id', sa.String(40), nullable=False, unique=True),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('billing_products.id', ondelete='SET NULL'), nullable=True),
        sa.Column('variant_id', sa.String(40), nullable=False),
        sa.Column('status', sa.String(30), nullable=False),
        sa.Column('renews_at', sa.DateTime(), nullable=True),
        sa.Column('ends_at', sa.DateTime(), nullable=True),
        sa.Column('portal_url', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_subscriptions_workspace_id', 'subscriptions', ['workspace_id'])
    op.create_table(
        'billing_events',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('event_name', sa.String(60), nullable=False),
        sa.Column('lemon_id', sa.String(40), nullable=True),
        sa.Column('workspace_id', sa.Integer(), nullable=True),
        sa.Column('ok', sa.Boolean(), nullable=False),
        sa.Column('error', sa.String(300), nullable=True),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_billing_events_created_at', 'billing_events', ['created_at'])
    op.create_table(
        'admin_audit_log',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('action', sa.String(60), nullable=False),
        sa.Column('target', sa.String(120), nullable=False, server_default=''),
        sa.Column('detail', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_admin_audit_log_created_at', 'admin_audit_log', ['created_at'])

    if op.get_bind().dialect.name == "postgresql":  # Supabase PostgREST'e kapalı (bkz. 0022)
        for name in NEW_TABLES:
            op.execute(f"ALTER TABLE public.{name} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index('ix_admin_audit_log_created_at', 'admin_audit_log')
    op.drop_table('admin_audit_log')
    op.drop_index('ix_billing_events_created_at', 'billing_events')
    op.drop_table('billing_events')
    op.drop_index('ix_subscriptions_workspace_id', 'subscriptions')
    op.drop_table('subscriptions')
    op.drop_table('billing_products')
    op.drop_index('ix_credit_ledger_created_at', 'credit_ledger')
    op.drop_index('ix_credit_ledger_workspace_id', 'credit_ledger')
    op.drop_table('credit_ledger')
    op.drop_table('credit_balances')
    op.drop_table('app_settings')
    op.drop_table('ai_task_models')
    op.drop_table('ai_models')
    op.drop_table('ai_provider_keys')

"""shipping_invoices: kalem adı, fatura no, parmak izi (kalem bazlı mükerrer kontrolü)

Revision ID: a7c9e1f3b5d7
Revises: f5b7d9e1a3c5
Create Date: 2026-09-26 00:00:00.000000

"""
from collections import defaultdict
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a7c9e1f3b5d7'
down_revision: Union[str, None] = 'f5b7d9e1a3c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shipping_invoices') as b:
        b.add_column(sa.Column('description', sa.String(length=200), nullable=False, server_default=''))
        b.add_column(sa.Column('invoice_no', sa.String(length=60), nullable=False, server_default=''))
        b.add_column(sa.Column('fingerprint', sa.String(length=200), nullable=False, server_default=''))
    op.create_index('ix_shipping_invoices_fingerprint', 'shipping_invoices', ['fingerprint'])

    # Mevcut satırlar: fatura no = dosya adı (FedEx'te dosya adı fatura numarasıdır), parmak izi = aynı fatura + gönderi + tür
    # grubunun toplam tutarı (dağıtılmış satırların toplamı = orijinal kalem tutarı).
    conn = op.get_bind()
    rows = conn.execute(sa.text('SELECT id, receipt_id, tracking_no, kind, original_amount, source_filename FROM shipping_invoices')).fetchall()
    groups = defaultdict(list)
    for r in rows:
        stem = (r.source_filename or '').rsplit('.', 1)[0]
        who = r.tracking_no or f'r{r.receipt_id}'
        groups[(stem, who, r.kind)].append(r)
    for (stem, who, kind), items in groups.items():
        total = round(sum(i.original_amount for i in items), 2)
        fp = f'{stem}|{who}|{kind}|{total:.2f}'
        for i in items:
            conn.execute(sa.text('UPDATE shipping_invoices SET invoice_no=:n, fingerprint=:f WHERE id=:id'), {'n': stem, 'f': fp, 'id': i.id})


def downgrade() -> None:
    op.drop_index('ix_shipping_invoices_fingerprint', table_name='shipping_invoices')
    with op.batch_alter_table('shipping_invoices') as b:
        b.drop_column('fingerprint')
        b.drop_column('invoice_no')
        b.drop_column('description')

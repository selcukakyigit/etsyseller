"""keyword status and pinned

Yönetim havuz kararları: `status` (active | archived | blocked) ve `pinned` (kullanılmasa da yenilenir). Mevcut kelimeler `active`, sabitli değil.

Revision ID: 0069
Revises: 0068
Create Date: 2026-10-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0069'
down_revision: Union[str, None] = '0068'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("keyword_terms", sa.Column("status", sa.String(10), nullable=False, server_default="active"))
    op.add_column("keyword_terms", sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_keyword_terms_status", "keyword_terms", ["status"])


def downgrade() -> None:
    op.drop_index("ix_keyword_terms_status", table_name="keyword_terms")
    op.drop_column("keyword_terms", "pinned")
    op.drop_column("keyword_terms", "status")

"""shared product measures

Ürün tanımları (ebat, kesim, parça, malzeme…) tedarikçi kaydına değil ÇALIŞMA ALANINA bağlanır: `entity_product_measures` yerine
`product_measures`. Malzeme artık tedarikçinin fiyat listesindeki bir kalem değil, tür + kalınlıktır (tedarikçiler kendi fiyat
kalemlerini bununla eşler). Aynı ürün birden çok kayıtta tanımlıysa en son güncellenen kalır. Geri dönüşü yoktur.

Revision ID: 0040
Revises: 0039
Create Date: 2026-10-10 10:00:00.000000

"""
import datetime as dt
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0040'
down_revision: Union[str, None] = '0039'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from app.modkit import materials  # tür ve kalınlık, eski kalemin alanlarından ya da adından okunur

    bind = op.get_bind()
    # Eski tablonun benzersiz kısıtı yeni tabloyla aynı adı taşır (PostgreSQL'de kısıt adı şemada benzersizdir): önce kaldırılır.
    op.drop_constraint("uq_product_measures_target_key", "entity_product_measures", type_="unique")
    new = op.create_table(
        "product_measures",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("listing_id", sa.BigInteger(), nullable=False),
        sa.Column("variant", sa.String(300), nullable=False, server_default=""),
        sa.Column("part", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("key", sa.String(30), nullable=False),
        sa.Column("value", sa.Numeric(18, 4, asdecimal=False), nullable=False),
        sa.Column("text", sa.String(20), nullable=False, server_default=""),
        sa.Column("source", sa.String(8), nullable=False, server_default="manual"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "shop_id", "listing_id", "variant", "part", "key", name="uq_product_measures_target_key"),
    )
    op.create_index("ix_product_measures_workspace_id", "product_measures", ["workspace_id"])
    op.create_index("ix_product_measures_shop_id", "product_measures", ["shop_id"])

    old = bind.execute(sa.text(
        "SELECT m.shop_id, m.listing_id, m.variant, m.part, m.key, m.value, m.source, m.updated_at, m.item_id, e.workspace_id "
        "FROM entity_product_measures m JOIN module_entities e ON e.id = m.entity_id ORDER BY m.updated_at, m.id"
    )).mappings().all()
    items = {r["id"]: r for r in bind.execute(sa.text("SELECT id, name, spec, material, thickness_mm FROM price_items")).mappings()}
    rows: dict[tuple, dict] = {}  # sonra yazılan (daha yeni güncellenen) önceki satırın yerini alır

    def put(r, key: str, value: float, text: str = "") -> None:
        rows[(r["workspace_id"], r["shop_id"], r["listing_id"], r["variant"], r["part"], key)] = {
            "workspace_id": r["workspace_id"], "shop_id": r["shop_id"], "listing_id": r["listing_id"], "variant": r["variant"], "part": r["part"],
            "key": key, "value": value, "text": text, "source": r["source"], "updated_at": r["updated_at"] or dt.datetime.utcnow(),
        }

    for r in old:
        if r["key"] != "material":
            put(r, r["key"], r["value"])
            continue
        item = items.get(r["item_id"])
        if item is None:
            continue  # kalemi silinmiş malzeme bağı
        shim = type("Item", (), dict(item))
        kind, thickness = materials.spec_of(shim)
        if kind:
            put(r, "material", 0.0, kind)
        if thickness:
            put(r, "thickness", float(thickness))
    if rows:
        op.bulk_insert(new, list(rows.values()))
    op.drop_table("entity_product_measures")


def downgrade() -> None:
    raise NotImplementedError("Ürün tanımlarının çalışma alanına taşınması geri alınamaz (tedarikçi kayıtlarına geri dağıtılamaz).")

"""Örnek mağaza: uydurma veri gerçek servislerle (ilan listesi, düzenleme, siparişler, finans) hatasız çalışmalı ve gerçek veri içermemeli."""
import datetime as dt
import json

import pytest

from app.auth.models import User, Workspace, WorkspaceMember
from app.demo import seed
from app.finance import service as finance
from app.listings import service as listings
from app.orders import service as orders
from app.shops.models import Shop


@pytest.fixture
def shop(db):
    user = User(supabase_id="sb-demo", email="demo-test@x.co", name="D")
    ws = Workspace(name="W")
    db.add_all([user, ws])
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    row = Shop(user_id=user.id, workspace_id=ws.id, etsy_shop_id=-1, etsy_user_id=-1, shop_name=seed.SHOP_NAME, is_demo=True)
    db.add(row)
    db.commit()
    return row


def test_seed_counts_and_listing_images(db, shop):
    counts = seed.seed_shop(db, shop)
    assert counts == {"listings": 5, "orders": seed.N_ORDERS, "open_orders": seed.N_OPEN}
    cards = listings.list_listings(db, shop)
    assert len(cards) == 5
    for spec in seed.LISTINGS:
        raw = next(json.loads(r.raw_json) for r in db.query(seed.ListingCache).filter_by(shop_id=shop.id) if r.title == spec["title"])
        assert len(raw["images"]) == 2 and raw["videos"] == []
        assert 8 <= len(raw["tags"]) <= 13


def test_listing_edit_opens_without_etsy(db, shop):
    seed.seed_shop(db, shop)
    out = listings.get_listing_for_edit(db, shop, seed.FIRST_LISTING_ID)
    assert out.title.startswith("Speckled Stoneware")


def test_orders_tabs(db, shop):
    seed.seed_shop(db, shop)
    to_ship = orders.orders_page(db, shop, tab="toship")
    done = orders.orders_page(db, shop, tab="completed")
    assert to_ship.total == seed.N_OPEN
    assert done.total == seed.N_ORDERS - seed.N_OPEN


def test_finance_report_has_profit(db, shop):
    seed.seed_shop(db, shop)
    today = dt.datetime.utcnow().date()
    rep = finance.report(db, shop, today - dt.timedelta(days=seed.HISTORY_DAYS), today)
    kpis = rep["kpis"] if "kpis" in rep else rep
    assert rep["products"], "ürün kârlılığı boş"
    assert any(p["profit"] > 0 for p in rep["products"])


def test_no_real_data_markers(db, shop):
    seed.seed_shop(db, shop)
    for row in db.query(seed.OrderCache).filter_by(shop_id=shop.id):
        assert row.buyer_name.startswith("Demo Buyer")
        raw = json.loads(row.raw_json)
        assert "Sample" in raw["first_line"] and raw["zip"] == "00000"


def test_reseeding_replaces_instead_of_duplicating(db, shop):
    seed.seed_shop(db, shop)
    seed.seed_shop(db, shop)
    assert db.query(seed.OrderCache).filter_by(shop_id=shop.id).count() == seed.N_ORDERS

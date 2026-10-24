"""Etsy verisi kaydı: aynı ölçüm yeniden yapıştırılınca satır çoğalmaz, güncellenir; farklı dönem yeni tarihli satır olur (geçmiş korunur)."""
from types import SimpleNamespace

from sqlalchemy import select

from app.insights import etsy_data
from app.insights.models import EtsyKeywordData

SHOP = SimpleNamespace(id=1)


def _rows(db):
    return db.scalars(select(EtsyKeywordData).order_by(EtsyKeywordData.id)).all()


def test_same_period_paste_updates_instead_of_duplicating(db):
    first = etsy_data.save(db, SHOP, 7, "ads", [{"keyword": "Metal Yard Art", "views": 100, "clicks": 4, "orders": 0}], "2026-09-01", "2026-09-30")
    again = etsy_data.save(db, SHOP, 7, "ads", [{"keyword": "metal yard art", "views": 180, "clicks": 9, "orders": 1}], "2026-09-01", "2026-09-30")
    rows = _rows(db)
    assert (first["saved"], again["saved"], again["updated"]) == (1, 0, 1)
    assert len(rows) == 1 and (rows[0].views, rows[0].clicks, rows[0].orders) == (180, 9, 1)


def test_new_period_keeps_history(db):
    etsy_data.save(db, SHOP, 7, "ads", [{"keyword": "metal yard art", "views": 100}], "2026-08-01", "2026-08-31")
    etsy_data.save(db, SHOP, 7, "ads", [{"keyword": "metal yard art", "views": 180}], "2026-09-01", "2026-09-30")
    assert [r.views for r in _rows(db)] == [100, 180]


def test_without_period_same_day_updates(db):
    etsy_data.save(db, SHOP, None, "marketplace_insights", [{"keyword": "custom metal sign", "searches": 18000}])
    out = etsy_data.save(db, SHOP, None, "marketplace_insights", [{"keyword": "custom metal sign", "searches": 18700}])
    rows = _rows(db)
    assert out["updated"] == 1 and len(rows) == 1 and rows[0].searches == 18700


def test_other_listing_or_shop_is_not_touched(db):
    etsy_data.save(db, SHOP, 7, "ads", [{"keyword": "metal yard art", "views": 100}], "2026-09-01", "2026-09-30")
    etsy_data.save(db, SHOP, 8, "ads", [{"keyword": "metal yard art", "views": 50}], "2026-09-01", "2026-09-30")
    etsy_data.save(db, SimpleNamespace(id=2), 7, "ads", [{"keyword": "metal yard art", "views": 10}], "2026-09-01", "2026-09-30")
    assert sorted(r.views for r in _rows(db)) == [10, 50, 100]

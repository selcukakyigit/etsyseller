"""Yönetim havuz ekranı: sıralama/süzgeç, mağazaların Insights yapıştırması özeti (kimliksiz, ayrı), maliyet raporu."""
import datetime as dt

from app.insights import etsy_data
from app.research import admin, pool
from app.research.models import KeywordMetric, ProviderCall


def _metric(db, kw, volume, cpc, days_ago=1):
    t = dt.datetime.utcnow() - dt.timedelta(days=days_ago)
    db.add(KeywordMetric(keyword_id=kw.id, provider="p", source="google_ads", market="US", language="en", search_volume=volume, cpc=cpc, measured_at=t, expires_at=t + dt.timedelta(days=20)))


def _list(db, **kw):
    return admin.keywords(db, q="", state="", market="US", language="en", page=1, **kw)


def _shop(n):
    from types import SimpleNamespace

    return SimpleNamespace(id=n)


def test_sorting_puts_missing_metrics_last_and_source_filter(db):
    rows = pool.get_or_create_terms(db, ["low vol", "high vol", "no data"], "en", "volume")
    pool.get_or_create_terms(db, ["asked by admin"], "en", "admin")
    _metric(db, rows["low vol"], 10, 0.5)
    _metric(db, rows["high vol"], 9000, 2.0)
    db.commit()
    order = [i.term for i in _list(db, sort="volume").items]
    assert order.index("high vol") < order.index("low vol") < order.index("no data")
    assert [i.term for i in _list(db, sort="cpc").items][:2] == ["high vol", "low vol"]
    assert [i.term for i in _list(db, source="admin").items] == ["asked by admin"]


def test_etsy_filter_counts_shops_and_detail_summary_has_no_shop_ids(db):
    rows = pool.get_or_create_terms(db, ["metal garage sign", "other"], "en", "volume")
    etsy_data.save(db, _shop(1), None, "marketplace_insights", [{"keyword": "metal garage sign", "searches": 1300, "listings_count": 67800, "conversion": "very_low", "trend_pct": -44}])
    etsy_data.save(db, _shop(2), None, "marketplace_insights", [{"keyword": "metal garage sign", "searches": 1500, "listings_count": 70000, "conversion": "very_low"}])
    etsy_data.save(db, _shop(3), 7, "ads", [{"keyword": "other", "views": 5, "clicks": 1, "orders": 0}])  # Ads havuz özetine girmez
    out = _list(db, etsy=True)
    assert [(i.term, i.etsy_shops) for i in out.items] == [("metal garage sign", 2)]
    summary = admin.etsy_insights(db, "metal garage sign")
    assert (summary.shops, summary.searches_min, summary.searches_max, summary.conversion) == (2, 1300, 1500, "very_low")
    assert "shop" not in " ".join(summary.model_dump()).replace("shops", "")  # mağaza kimliği alanı yok
    assert admin.etsy_insights(db, "other") is None
    detail = admin.keyword_detail(db, rows["metal garage sign"].id, "US")
    assert detail.etsy.shops == 2 and admin.keyword_detail(db, rows["other"].id, "US").etsy is None


def test_cost_report_fills_empty_days_groups_by_endpoint_and_projects(db):
    now = dt.datetime.utcnow()
    db.add_all([
        ProviderCall(provider="p", endpoint="volume", market="US", language="en", cost_usd=0.5, created_at=now),
        ProviderCall(provider="p", endpoint="volume", market="US", language="en", cost_usd=0.25, ok=False, error="x", created_at=now - dt.timedelta(days=3)),
        ProviderCall(provider="p", endpoint="trends", market="US", language="en", cost_usd=0.1, created_at=now),
        ProviderCall(provider="p", endpoint="old", market="US", language="en", cost_usd=9, created_at=now - dt.timedelta(days=60)),
    ])
    db.commit()
    out = admin.cost_report(db)
    assert len(out.days) == 30 and out.days[-1].day == now.date().isoformat()
    assert sum(d.cost_usd for d in out.days) == 0.85 and sum(1 for d in out.days if d.calls == 0) >= 27
    assert [(e.endpoint, e.cost_usd, e.errors) for e in out.by_endpoint] == [("volume", 0.75, 1), ("trends", 0.1, 0)]
    assert out.projected_month >= out.month_spend

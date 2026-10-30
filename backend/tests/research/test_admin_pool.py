"""Yönetim havuz ekranı: sıralama/süzgeç, mağazaların Insights yapıştırması özeti (kimliksiz, ayrı), maliyet raporu."""
import datetime as dt

from app.insights import etsy_data
from app.research import admin, admin_pool, pool
from app.research.models import KeywordMetric, ProviderCall


def _metric(db, kw, volume, cpc, days_ago=1):
    t = dt.datetime.utcnow() - dt.timedelta(days=days_ago)
    db.add(KeywordMetric(keyword_id=kw.id, provider="p", source="google_ads", market="US", language="en", search_volume=volume, cpc=cpc, measured_at=t, expires_at=t + dt.timedelta(days=20)))


def _list(db, sort="new", **kw):
    return admin_pool.keywords(db, admin_pool.KeywordFilters(market="US", language="en", **kw), page=1, sort=sort)


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


def test_add_metrics_keeps_exactly_one_latest_row_and_the_list_shows_it(db):
    from app.research.records import MetricRecord

    rows = pool.get_or_create_terms(db, ["metal sign"], "en", "volume")
    for volume in (100, 250):
        pool.add_metrics(db, rows, [MetricRecord(term="metal sign", search_volume=volume)], provider="p", source="google_ads", market="US", language="en", ttl_days=21)
        db.commit()
    flags = [(m.search_volume, m.is_latest) for m in db.query(KeywordMetric).order_by(KeywordMetric.id)]
    assert flags == [(100, False), (250, True)]
    assert _list(db).items[0].search_volume == 250
    pool.add_metrics(db, rows, [MetricRecord(term="metal sign", search_volume=7)], provider="p", source="google_ads", market="GB", language="en", ttl_days=21)
    db.commit()
    assert sum(m.is_latest for m in db.query(KeywordMetric)) == 2, "farklı pazar ayrı güncel satır"


def test_missing_rows_say_why(db, provider):
    from app.research import service
    from app.research.models import ResearchJob

    rows = pool.get_or_create_terms(db, ["queued term", "failed term", "gb only", "never asked"], "en", "volume")
    service.request_refresh(db, ["queued term"])  # sıraya girer
    db.add(ResearchJob(kind="volume", provider="dataforseo", market="US", language="en", idem_key="dead1", params_json='{"terms": ["failed term"]}', status="dead", error="boom"))
    _metric(db, rows["gb only"], 5, 0.1)
    db.flush()
    db.query(KeywordMetric).update({KeywordMetric.market: "GB"})
    db.commit()
    by = {i.term: (i.state, i.reason, i.reason_detail) for i in _list(db).items}
    assert by["queued term"] == ("missing", "queued", "")
    assert by["failed term"] == ("missing", "failed", "boom")
    assert by["gb only"] == ("missing", "other_market", "GB")
    assert by["never asked"] == ("missing", "none", "")


def test_total_is_capped_and_bulk_measure_follows_the_filters(db, provider, monkeypatch):
    from app.research import service

    rows = pool.get_or_create_terms(db, ["a one", "b two", "c three"], "en", "volume")
    _metric(db, rows["a one"], 10, 0.1)
    db.commit()
    monkeypatch.setattr(admin_pool, "TOTAL_CAP", 2)
    out = _list(db)
    assert (out.total, out.capped) == (2, True)
    monkeypatch.undo()
    terms = [k.term for k in admin_pool.matching_terms(db, admin_pool.KeywordFilters(state="missing", market="US", language="en"))]
    assert sorted(terms) == ["b two", "c three"], "ölçümü olanlar ölçtürülmez"
    result = service.request_refresh(db, terms, market="US", language="en")
    assert result.pending == 2 and result.refused is None

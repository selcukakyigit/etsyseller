"""Havuz yönetimi: süzgeçler, toplu işlem (engelle / sabitle / arşivle / sil / ölç), dışa aktarma, sağlık ve analitik; engelli kelime hiç araştırılmaz."""
import csv
import datetime as dt
import io
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from app.admin.deps import admin_only
from app.core import app_settings
from app.core.db import SessionLocal, get_db
from app.insights.models import TrackedKeyword
from app.research import admin_pool, admin_stats, discover, pool, service, stats, worker
from app.research.admin_pool import BulkIn, KeywordFilters
from app.research.models import KeywordLink, KeywordMetric, KeywordTerm, ResearchJob, SavedKeyword
from tests.research.test_discover import SHOP_A


def _metric(db, kw, volume=100, *, expires_in_days=20, intent=None, market="US"):
    t = dt.datetime.utcnow() - dt.timedelta(days=1)
    db.add(KeywordMetric(
        keyword_id=kw.id, provider="p", source="google_ads", market=market, language="en", search_volume=volume, intent=intent, measured_at=t,
        expires_at=dt.datetime.utcnow() + dt.timedelta(days=expires_in_days),
    ))


def _seed(db):
    rows = pool.get_or_create_terms(db, ["big sign", "mid sign", "tiny sign", "no data sign", "100% cotton"], "en", "volume")
    _metric(db, rows["big sign"], 5000, expires_in_days=3, intent="commercial")
    _metric(db, rows["mid sign"], 400, expires_in_days=20, intent="informational")
    _metric(db, rows["tiny sign"], 20, expires_in_days=-2)
    db.commit()
    return rows


def _terms(db, **f):
    return sorted(i.term for i in admin_pool.keywords(db, KeywordFilters(market="US", language="en", **f), page=1).items)


def test_filters_combine_volume_intent_expiry_and_state(db):
    _seed(db)
    assert _terms(db, min_volume=300) == ["big sign", "mid sign"]
    assert _terms(db, max_volume=100) == ["tiny sign"]
    assert _terms(db, intent="commercial") == ["big sign"]
    assert _terms(db, expiring_days=7) == ["big sign"]  # yalnızca güncel ve 7 gün içinde dolacak olan
    assert _terms(db, state="stale") == ["tiny sign"]
    assert _terms(db, state="missing") == ["100% cotton", "no data sign"]
    assert _terms(db, min_volume=300, intent="informational") == ["mid sign"]


def test_search_text_is_literal_not_a_like_pattern(db):
    _seed(db)
    assert _terms(db, q="%") == ["100% cotton"]  # '%' joker değil
    assert _terms(db, q="_") == []
    assert _terms(db, q="SIGN") == ["big sign", "mid sign", "no data sign", "tiny sign"]


def test_unused_filter_and_sort_by_usage(db):
    rows = _seed(db)
    pool.touch(db, [rows["big sign"].id])
    rows["mid sign"].last_used_at = dt.datetime.utcnow() - dt.timedelta(days=120)
    db.commit()
    assert _terms(db, unused_days=90) == ["100% cotton", "mid sign", "no data sign", "tiny sign"]  # hiç kullanılmayanlar da dahil
    first = admin_pool.keywords(db, KeywordFilters(market="US", language="en"), page=1, sort="used").items[0]
    assert first.term == "big sign"


def test_bulk_status_changes_count_only_real_changes_and_follow_the_filter(db):
    rows = _seed(db)
    out = admin_pool.apply_bulk(db, BulkIn(action="pin", ids=[rows["big sign"].id, rows["mid sign"].id]))
    assert (out.matched, out.changed) == (2, 2)
    assert admin_pool.apply_bulk(db, BulkIn(action="pin", ids=[rows["big sign"].id])).changed == 0  # zaten sabitli
    assert _terms(db, pinned="yes") == ["big sign", "mid sign"]

    out = admin_pool.apply_bulk(db, BulkIn(action="block", filters=KeywordFilters(market="US", language="en", max_volume=500)))
    assert out.matched == 2 and out.changed == 2  # mid sign + tiny sign
    assert _terms(db, status="blocked") == ["mid sign", "tiny sign"]
    assert _terms(db, pinned="yes") == ["big sign"], "engellenen kelime sabitli kalamaz"
    assert admin_pool.apply_bulk(db, BulkIn(action="unblock", filters=KeywordFilters(status="blocked", market="US", language="en"))).changed == 2
    assert admin_pool.apply_bulk(db, BulkIn(action="archive", ids=[rows["tiny sign"].id])).changed == 1
    assert admin_pool.apply_bulk(db, BulkIn(action="unarchive", ids=[rows["tiny sign"].id])).changed == 1


def test_bulk_needs_exactly_one_target():
    with pytest.raises(ValidationError):
        BulkIn(action="pin")
    with pytest.raises(ValidationError):
        BulkIn(action="pin", ids=[1], filters=KeywordFilters())
    with pytest.raises(ValidationError):
        BulkIn(action="explode", ids=[1])


def test_delete_removes_pool_data_but_never_tenant_saved_or_tracked_keywords(db):
    rows = _seed(db)
    pool.link_suggestions(db, rows["big sign"].id, [rows["mid sign"]])
    db.add(SavedKeyword(workspace_id=1, term="mid sign", collection=""))
    db.add(TrackedKeyword(shop_id=1, listing_id=1, keyword="tiny sign", active=True))
    db.commit()
    ids = [rows[t].id for t in ("big sign", "mid sign", "tiny sign")]
    out = admin_pool.apply_bulk(db, BulkIn(action="delete", ids=ids))
    assert (out.matched, out.changed, out.skipped) == (3, 1, 2)
    assert db.scalar(select(KeywordTerm).where(KeywordTerm.term == "big sign")) is None
    assert db.scalars(select(KeywordMetric).where(KeywordMetric.keyword_id == rows["big sign"].id)).all() == []
    assert db.scalars(select(KeywordLink)).all() == [], "silinen kelimenin ilişkileri de gider"
    assert _terms(db, q="sign") == ["mid sign", "no data sign", "tiny sign"]


def test_blocked_keyword_is_never_measured_queued_or_suggested(db, provider):
    rows = _seed(db)
    admin_pool.apply_bulk(db, BulkIn(action="block", ids=[rows["no data sign"].id, rows["tiny sign"].id]))
    out = service.volumes(db, ["no data sign", "tiny sign", "fresh new"])
    assert out.pending == 1 and db.query(ResearchJob).count() == 1  # yalnızca engelsiz yeni kelime
    assert admin_pool.apply_bulk(db, BulkIn(action="refresh", ids=[rows["no data sign"].id])).pending == 0
    assert service.request_refresh(db, ["tiny sign"]).pending == 0

    expansion = service.expand(db, "no data sign")
    assert expansion.metrics == {} and expansion.pending == 0

    admin_pool.apply_bulk(db, BulkIn(action="unblock", ids=[rows["tiny sign"].id]))
    seed = pool.get_or_create_terms(db, ["metal sign"], "en", "suggestion")["metal sign"]
    pool.link_suggestions(db, seed.id, [rows["tiny sign"], rows["no data sign"]])
    _metric(db, rows["no data sign"], 50)
    db.commit()
    admin_pool.apply_bulk(db, BulkIn(action="block", ids=[rows["no data sign"].id]))
    related = service.expand(db, "metal sign").metrics
    assert "no data sign" not in related and "tiny sign" in related


def test_discover_shows_nothing_for_a_blocked_seed(db, provider):
    discover.search(db, SHOP_A, "metal sign")
    worker.run_once(db)
    seed = db.scalar(select(KeywordTerm).where(KeywordTerm.term == "metal sign"))
    admin_pool.apply_bulk(db, BulkIn(action="block", ids=[seed.id]))
    provider.calls.clear()
    assert discover.search(db, SHOP_A, "metal sign").status in ("empty", "ready")
    assert not [c for c in provider.calls if c[0] in ("suggest", "volume")], "engelli kelime için sağlayıcıya gidilmez"
    assert db.query(ResearchJob).filter(ResearchJob.status == "queued").count() == 0


def test_daily_refresh_covers_pinned_unused_keywords_but_not_archived_ones(db, provider):
    rows = pool.get_or_create_terms(db, ["pinned old", "archived old", "plain old", "used old"], "en", "volume")
    old = dt.datetime.utcnow() - dt.timedelta(days=200)
    for kw in rows.values():
        db.add(KeywordMetric(keyword_id=kw.id, provider="p", source="google_ads", market="US", language="en", search_volume=100, measured_at=old, expires_at=old + dt.timedelta(days=21)))
    rows["pinned old"].pinned = True
    rows["archived old"].status = "archived"
    pool.touch(db, [rows["archived old"].id, rows["used old"].id])
    db.commit()
    assert service.refresh_stale(db) == 2
    worker.run_once(db)
    assert sorted(provider.calls[0][1]) == ["pinned old", "used old"]


def test_export_follows_the_filter_and_defuses_spreadsheet_formulas(db):
    rows = pool.get_or_create_terms(db, ["safe term", "other term"], "en", "volume")
    _metric(db, rows["safe term"], 900)
    _metric(db, rows["other term"], 700)
    db.commit()
    text = "".join(admin_pool.export_csv(db, KeywordFilters(market="US", language="en", min_volume=800)))
    lines = list(csv.reader(io.StringIO(text)))
    assert lines[0] == admin_pool.EXPORT_HEADER and len(lines) == 2
    assert lines[1][0] == "safe term" and lines[1][3] == "900"
    # kelimeler kullanıcı girdisinden gelir; formül başlangıçları etkisizleştirilir (normalize uçtaki simgeleri zaten atar, bu ikinci savunma)
    assert [admin_pool._safe(v) for v in ("=1+1", "+1", "-1", "@x", "ok", None)] == ["'=1+1", "'+1", "'-1", "'@x", "ok", ""]


def test_health_counts_freshness_status_and_forecasts_the_refresh_cost(db):
    from app.research.models import ProviderCall

    rows = _seed(db)
    admin_pool.apply_bulk(db, BulkIn(action="pin", ids=[rows["big sign"].id]))
    db.add(ProviderCall(provider="p", endpoint="e", market="US", language="en", cost_usd=0.075, ok=True, kind="volume"))
    db.commit()
    admin_stats.clear_cache()
    h = admin_stats.health(db)
    assert (h.terms, h.fresh, h.expiring_7d, h.stale, h.missing) == (5, 2, 1, 1, 2)
    assert h.status == {"active": 5, "archived": 0, "blocked": 0} and h.pinned == 1
    assert (h.forecast.due, h.forecast.requests) == (3, 1) and h.forecast.estimated_usd in (0.07, 0.08)  # 3 kelime tek istek; 0,075 $
    assert [m.key for m in h.markets] == ["US/en"]


def test_analytics_summarises_hits_refusals_latency_and_empty_searches(db, provider):
    shop = SHOP_A
    discover.search(db, shop, "metal garage sign")  # ilk bakış: havuzda yok
    worker.run_once(db)
    stats.count(stats.REFUSED_PREFIX + "shop_month", 3)
    stats.search("nothing here", "US", empty=True)
    stats.flush(db)
    a = admin_stats.analytics(db)
    today = a.days[-1]
    assert today.search_miss == 1 and today.refused == 3
    assert a.hit_rate == 0.0
    assert [(r.key, r.count) for r in a.refused] == [("shop_month", 3)]
    assert {s.term for s in a.top_searches} >= {"metal garage sign", "nothing here"}
    assert [s.term for s in a.empty_searches] == ["nothing here"]
    suggest = next(item for item in a.latency if item.kind == "suggest")
    assert suggest.jobs == 1 and suggest.p50_s is not None
    assert a.shops[0].shop_id == 1 and a.shops[0].jobs >= 1


@pytest.fixture
def admin_client(db, provider):
    from app import main

    def _db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[get_db] = _db
    main.app.dependency_overrides[admin_only] = lambda: NS(id=1, email="admin@x.y", is_admin=True)
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_admin_api_routes_list_export_bulk_health_and_analytics(admin_client, db):
    rows = _seed(db)
    listed = admin_client.get("/api/admin/research/keywords", params={"min_volume": 300, "sort": "expires", "market": "US", "language": "en"})
    assert listed.status_code == 200, listed.json()
    assert [i["term"] for i in listed.json()["items"]] == ["big sign", "mid sign"]
    assert listed.json()["items"][0]["status"] == "active" and listed.json()["items"][0]["pinned"] is False

    export = admin_client.get("/api/admin/research/keywords/export", params={"market": "US", "language": "en", "intent": "commercial"})
    assert export.status_code == 200 and export.headers["content-type"].startswith("text/csv")  # {keyword_id} rotasına düşmez
    assert export.text.count("\n") == 2

    bad = admin_client.post("/api/admin/research/keywords/bulk", json={"action": "pin"})
    assert bad.status_code == 422
    ok = admin_client.post("/api/admin/research/keywords/bulk", json={"action": "pin", "ids": [rows["big sign"].id]})
    assert ok.status_code == 200 and ok.json()["changed"] == 1

    app_settings.set_many(db, {"research_budget_season_usd": 1.0})
    current = admin_client.get("/api/admin/research/settings").json()
    defaults = admin_client.get("/api/admin/research/settings/defaults").json()
    assert current["research_budget_season_usd"] == 1.0 and defaults["research_budget_season_usd"] == 5.0  # varsayılanlar kayıtlı değeri göstermez
    assert set(defaults) == set(current)

    assert admin_client.get("/api/admin/research/health").json()["terms"] == 5
    assert "days" in admin_client.get("/api/admin/research/analytics").json()

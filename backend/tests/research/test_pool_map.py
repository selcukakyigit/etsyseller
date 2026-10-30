"""Yönetim ülke haritası: pazar başına toplulaştırma, kelime süzgeci ve bölge, kapsam, harcama, yalnızca yönetici."""
import datetime as dt
from types import SimpleNamespace as NS

from fastapi.testclient import TestClient

from app.research import admin_map, pool
from app.research.models import KeywordMetric, ProviderCall

NOW = dt.datetime.utcnow()


def _m(db, kw, market, volume, *, cpc=0.5, intent="commercial", fresh=True, language="en", latest=True):
    t = NOW - dt.timedelta(days=1)
    db.add(KeywordMetric(
        keyword_id=kw.id, provider="p", source="google_ads", market=market, language=language, search_volume=volume, cpc=cpc, intent=intent, measured_at=t,
        expires_at=NOW + dt.timedelta(days=10) if fresh else NOW - dt.timedelta(days=1), is_latest=latest,
    ))


def _world(db, provider):
    provider.markets = ("US", "GB", "DE", "PL", "JP")
    rows = pool.get_or_create_terms(db, ["metal sign", "garden sign", "tiny sign", "barn door"], "en", "volume")
    _m(db, rows["metal sign"], "US", 1000); _m(db, rows["garden sign"], "US", 500, intent="informational"); _m(db, rows["tiny sign"], "US", 20, fresh=False)
    _m(db, rows["metal sign"], "GB", 300); _m(db, rows["garden sign"], "GB", None)  # sağlayıcı GB'de garden sign için veri vermedi
    _m(db, rows["metal sign"], "DE", 200, cpc=1.0); _m(db, rows["barn door"], "JP", 40)
    _m(db, rows["metal sign"], "US", 9999, latest=False)  # eski ölçüm: sayılmaz
    db.commit()
    return rows


def _by(out):
    return {r.market: r for r in out.rows}


def test_aggregates_the_latest_measurements_per_market(db, provider):
    _world(db, provider)
    out = admin_map.pool_map(db, admin_map.MapQuery(language="en"))
    rows = _by(out)
    assert out.terms == 4 and out.default_market == "US"
    us = rows["US"]
    assert (us.keywords, us.with_volume, us.volume, us.fresh, us.stale, us.coverage, us.default) == (3, 3, 1520, 2, 1, 75, True), "eski ölçüm (is_latest=false) toplama girmez"
    gb = rows["GB"]
    assert (gb.keywords, gb.with_volume, gb.volume) == (2, 1, 300), "veri dönmeyen kelime ölçülmüş sayılır ama hacme katılmaz"
    assert rows["DE"].avg_cpc == 1.0 and rows["PL"].keywords == 0 and rows["PL"].configured is True
    assert [r.market for r in out.rows][:2] == ["US", "GB"], "hacme göre azalan"


def test_keyword_filters_narrow_every_market_the_same_way_as_the_keyword_list(db, provider):
    _world(db, provider)
    rows = _by(admin_map.pool_map(db, admin_map.MapQuery(language="en", q="garden")))
    assert (rows["US"].keywords, rows["US"].volume, rows["GB"].keywords, rows["DE"].keywords) == (1, 500, 1, 0)
    assert admin_map.pool_map(db, admin_map.MapQuery(language="en", q="garden")).terms == 1
    assert _by(admin_map.pool_map(db, admin_map.MapQuery(language="en", min_volume=250)))["US"].volume == 1500
    assert _by(admin_map.pool_map(db, admin_map.MapQuery(language="en", intent="informational")))["US"].keywords == 1
    assert _by(admin_map.pool_map(db, admin_map.MapQuery(language="en", state="stale")))["US"].keywords == 1
    assert _by(admin_map.pool_map(db, admin_map.MapQuery(language="en", state="fresh")))["US"].keywords == 2


def test_regions_group_markets(db, provider):
    _world(db, provider)
    assert {r.market for r in admin_map.pool_map(db, admin_map.MapQuery(language="en", region="english")).rows} == {"US", "GB"}
    assert {r.market for r in admin_map.pool_map(db, admin_map.MapQuery(language="en", region="eu")).rows} == {"DE", "PL"}
    assert {r.market for r in admin_map.pool_map(db, admin_map.MapQuery(language="en", region="other")).rows} == {"JP"}
    assert "GB" in {r.market for r in admin_map.pool_map(db, admin_map.MapQuery(language="en", region="west")).rows}


def test_monthly_spend_per_market_ignores_keyword_filters(db, provider):
    _world(db, provider)
    for market, cost in (("US", 0.5), ("GB", 0.25), ("GB", 0.25)):
        db.add(ProviderCall(provider="dataforseo", endpoint="x", market=market, language="en", items=1, cost_usd=cost, duration_ms=1, ok=True, kind="volume"))
    db.add(ProviderCall(provider="dataforseo", endpoint="x", market="GB", language="en", items=1, cost_usd=9.0, duration_ms=1, ok=True, kind="volume", created_at=NOW - dt.timedelta(days=70)))
    db.commit()
    rows = _by(admin_map.pool_map(db, admin_map.MapQuery(language="en", q="garden")))
    assert (rows["GB"].spend_month, rows["GB"].calls_month, rows["US"].spend_month) == (0.5, 2, 0.5), "geçen aylar sayılmaz; süzgeç harcamayı değiştirmez"


def test_other_languages_and_empty_pool_are_well_formed(db, provider):
    provider.markets = ("US", "GB")
    out = admin_map.pool_map(db, admin_map.MapQuery(language="en"))
    assert out.terms == 0 and [r.keywords for r in out.rows] == [0, 0] and all(r.coverage == 0 and r.last_measured is None for r in out.rows)
    rows = pool.get_or_create_terms(db, ["metal sign"], "de", "volume")
    _m(db, rows["metal sign"], "DE", 70, language="de")
    db.commit()
    assert "DE" not in {r.market for r in admin_map.pool_map(db, admin_map.MapQuery(language="en")).rows if r.keywords}, "başka dilin ölçümü karışmaz"


def test_endpoint_is_admin_only_and_validates_the_region(db, provider):
    from app import main
    from app.admin.deps import admin_only
    from app.core.db import SessionLocal, get_db

    _world(db, provider)

    def _db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    client = TestClient(main.app)
    main.app.dependency_overrides[get_db] = _db
    try:
        assert client.get("/api/admin/research/map").status_code in (401, 403), "yönetici olmayan göremez"
        main.app.dependency_overrides[admin_only] = lambda: NS(id=1, email="a@b.c", is_admin=True)
        ok = client.get("/api/admin/research/map?region=english&q=metal")
        assert ok.status_code == 200 and {r["market"] for r in ok.json()["rows"]} == {"US", "GB"}
        assert client.get("/api/admin/research/map?region=mars").status_code == 422
    finally:
        main.app.dependency_overrides.clear()

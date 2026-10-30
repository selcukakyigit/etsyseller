"""Keşfet ana ekranının zengin bölümleri: ülke ölçümü (haftalık toplu iş), sezon takvimi, yükselenler/düşenler, fırsatlar, müşteri ülkeleri, yalıtım ve asistan karşılığı."""
import datetime as dt
import json
from types import SimpleNamespace as NS

from fastapi.testclient import TestClient

from app.assistant import tools as assistant_tools
from app.assistant.toolsets import research as tools
from app.core import app_settings
from app.core.db import SessionLocal, get_db
from app.listings.models import ListingCache
from app.orders.models import OrderCache
from app.research import jobs, overview, pool, service, worker
from app.research.models import KeywordMetric, ProviderCall, ResearchJob, SuggestionExposure
from app.shops.deps import get_owned_shop
from tests.research.test_discover import SHOP_A, SHOP_B, _research

SEPT = dt.date(2026, 9, 15)  # sahte sağlayıcının mevsim profili Ekim-Kasım zirveli
TERMS = ["metal farm sign", "metal farm sign big", "metal farm sign mid", "metal farm sign tiny", "metal farm sign custom"]


def _listing(db, shop_id, listing_id, tags):
    db.add(ListingCache(shop_id=shop_id, listing_id=listing_id, raw_json=json.dumps({"tags": tags}), title="t"))
    db.commit()


def _order(db, shop_id, receipt_id, country, *, canceled=False, days_ago=10):
    db.add(OrderCache(
        shop_id=shop_id, receipt_id=receipt_id, status="paid", created_at=dt.datetime.combine(SEPT, dt.time.min) - dt.timedelta(days=days_ago), country_iso=country,
        is_canceled=canceled, raw_json="{}",
    ))


def _prepared(db, provider, markets=("US", "GB", "DE")):
    """Tohum kelime araştırılmış, öneriler ölçülmüş, hepsi kullanılmış (touch) ve ek pazarlar tanımlı."""
    provider.markets = markets
    _listing(db, 1, 1, ["metal farm sign"])
    _research(db, SHOP_A)
    service.volumes(db, TERMS)  # kullanıldı olarak işaretler (ölçümleri taze: iş açılmaz)
    return provider


def _run_all(db):
    worker.run_once(db)


# ---- ülke ölçümü (haftalık toplu iş)

def test_refresh_markets_measures_used_terms_in_every_other_market_with_one_request_each(db, provider):
    _prepared(db, provider)
    provider.volume_by_market = {"GB": 40, "DE": 15}
    pool.get_or_create_terms(db, ["never used term"], "en", "volume")
    db.commit()
    before = len(provider.volume_markets)
    assert service.refresh_markets(db) == 2 * len(TERMS), "iki ek pazar × kullanılan 5 kelime; kullanılmayan kelime ölçülmez"
    _run_all(db)
    assert sorted(provider.volume_markets[before:]) == ["DE", "GB"], "pazar başına tek toplu istek"
    gb = service.peek(db, TERMS, market="GB")
    assert {v.search_volume for v in gb.values()} == {40} and "never used term" not in gb
    assert service.refresh_markets(db) == 0, "ölçümler taze: ikinci tur istek açmaz"


def test_refresh_markets_respects_the_switch_and_the_default_market_is_not_requeued(db, provider):
    _prepared(db, provider, markets=("US",))
    assert service.refresh_markets(db) == 0, "tek pazar: ek ölçüm yok"
    provider.markets = ("US", "GB")
    app_settings.set_many(db, {"research_map_enabled": False})
    assert service.refresh_markets(db) == 0 and db.query(ResearchJob).filter(ResearchJob.market == "GB").count() == 0


def test_refresh_markets_stops_at_the_monthly_budget(db, provider):
    _prepared(db, provider)
    app_settings.set_many(db, {"research_monthly_budget_usd": 0.0})
    assert service.refresh_markets(db) == 0


def test_map_terms_limit_keeps_the_most_searched_terms(db, provider):
    _prepared(db, provider, markets=("US", "GB"))
    app_settings.set_many(db, {"research_map_terms": 2})
    assert service.refresh_markets(db) == 2
    queued = db.query(ResearchJob).filter(ResearchJob.market == "GB").one()
    assert sorted(jobs.params(queued)["terms"]) == ["metal farm sign big", "metal farm sign mid"], "ana pazarda en çok aranan ikisi (5000, 300; tohum 210 üçüncü)"


# ---- ülkelere göre talep

def test_country_demand_sums_the_tags_per_market_and_marks_missing_data_as_preparing(db, provider):
    _prepared(db, provider)
    early = overview.country_demand(db, TERMS)
    assert early["preparing"] is True and [r["market"] for r in early["rows"]][0] == "US", "ek pazarlar henüz ölçülmedi"
    provider.volume_by_market = {"GB": 40, "DE": 15}
    service.refresh_markets(db)
    _run_all(db)
    done = overview.country_demand(db, TERMS)
    rows = {r["market"]: r for r in done["rows"]}
    assert done["preparing"] is False and done["default_market"] == "US"
    assert rows["US"]["volume"] == 210 + 5000 + 300 + 20 + 80 and rows["US"]["top_term"] == "metal farm sign big" and rows["US"]["default"] is True
    assert rows["GB"]["volume"] == 5 * 40 and rows["DE"]["volume"] == 5 * 15
    assert [r["market"] for r in done["rows"]] == ["US", "GB", "DE"], "hacme göre azalan"
    assert sum(r["share"] for r in done["rows"]) in (99, 100, 101)


def test_country_demand_with_the_map_switched_off_shows_only_the_default_market(db, provider):
    _prepared(db, provider)
    app_settings.set_many(db, {"research_map_enabled": False})
    out = overview.country_demand(db, TERMS)
    assert out["enabled"] is False and [r["market"] for r in out["rows"]] == ["US"] and out["preparing"] is False


# ---- ana ekran bölümleri

def test_overview_sections_for_a_researched_shop(db, provider):
    _prepared(db, provider)
    _order(db, 1, 1, "US"); _order(db, 1, 2, "US"); _order(db, 1, 3, "US"); _order(db, 1, 4, "DE")
    _order(db, 1, 5, "GB", canceled=True)
    _order(db, 1, 6, "FR", days_ago=500)  # bir yıldan eski
    _order(db, 2, 7, "TR")
    db.commit()
    view = overview.overview(db, SHOP_A, SEPT)
    assert [(c["term"], c["in_months"], c["peak_months"]) for c in view.calendar] == [("metal farm sign", 1, [10, 11])]
    assert [m["term"] for m in view.movers["rising"]] == ["metal farm sign"] and view.movers["rising"][0]["trend_pct"] == 100 and view.movers["falling"] == []
    assert [o["term"] for o in view.opportunities] == ["metal farm sign big", "metal farm sign mid"], "hacim ≥ 100, mağazada olmayan; tiny (20) ve custom (80) elenir"
    assert view.customers["orders"] == 4 and [(r["country"], r["orders"], r["share"]) for r in view.customers["rows"]] == [("US", 3, 75), ("DE", 1, 25)], "iptal, eski ve başka mağaza sayılmaz"
    assert view.pulse["tags"] == 1 and view.pulse["measured"] == 1 and view.pulse["monthly_searches"] == 210 and view.pulse["top_market"] == "US"
    assert view.pulse["next_peak"] == {"term": "metal farm sign", "in_months": 1, "peak_months": [10, 11]}


def test_overview_never_asks_the_provider_and_never_queues_jobs(db, provider):
    _prepared(db, provider)
    jobs, calls = db.query(ResearchJob).count(), len(provider.calls)
    overview.overview(db, SHOP_A, SEPT)
    assert db.query(ResearchJob).count() == jobs and len(provider.calls) == calls


def test_crowded_suggestions_are_not_opportunities(db, provider):
    _prepared(db, provider)
    db.add(SuggestionExposure(term="metal farm sign big", shops=20))
    db.commit()
    assert [o["term"] for o in overview.overview(db, SHOP_A, SEPT).opportunities] == ["metal farm sign mid"]


def test_movers_ignore_rare_terms_and_small_changes(db, provider):
    _prepared(db, provider)
    kw = pool.find_terms(db, ["metal farm sign"], "en")["metal farm sign"]
    db.query(KeywordMetric).filter_by(keyword_id=kw.id).update({"search_volume": 30})  # çok az aranan: yüzde oynak
    db.commit()
    assert overview.overview(db, SHOP_A, SEPT).movers == {"rising": [], "falling": []}
    db.query(KeywordMetric).filter_by(keyword_id=kw.id).update({"search_volume": 210, "monthly_json": json.dumps([[2025, m, 100] for m in range(1, 13)])})
    db.commit()
    assert overview.overview(db, SHOP_A, SEPT).movers == {"rising": [], "falling": []}, "düz seri yön değildir"


def test_an_empty_shop_gets_empty_but_well_formed_sections(db, provider):
    out = overview.overview(db, SHOP_B, SEPT).as_dict()
    assert out["calendar"] == [] and out["opportunities"] == [] and out["customers"] == {"days": 365, "orders": 0, "rows": []}
    assert out["pulse"] == {"tags": 0, "measured": 0, "monthly_searches": 0, "top_market": None, "next_peak": None}
    assert out["countries"]["tags"] == 0 and out["countries"]["preparing"] is False


def test_another_shops_tags_and_orders_never_leak(db, provider):
    _prepared(db, provider)
    _listing(db, 2, 9, ["secret competitor tag"])
    _order(db, 2, 11, "JP")
    db.commit()
    payload = json.dumps(overview.overview(db, SHOP_A, SEPT).as_dict())
    assert "secret competitor tag" not in payload and "JP" not in payload
    other = overview.overview(db, SHOP_B, SEPT)
    assert [r["country"] for r in other.customers["rows"]] == ["JP"] and "metal farm sign" not in json.dumps(other.as_dict())


# ---- HTTP ve asistan

def test_overview_endpoint_returns_the_sections(db, provider):
    from app import main

    _prepared(db, provider)
    _order(db, 1, 1, "US")
    db.commit()

    def _db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[get_db] = _db
    main.app.dependency_overrides[get_owned_shop] = lambda: SHOP_A
    try:
        res = TestClient(main.app).get("/api/shops/1/discover/overview")
    finally:
        main.app.dependency_overrides.clear()
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"pulse", "calendar", "movers", "opportunities", "countries", "customers"}
    assert body["customers"]["rows"] == [{"country": "US", "orders": 1, "share": 100}]
    assert "crowd_shops" not in json.dumps(body)


def test_assistant_tool_matches_the_screen_and_is_registered_everywhere(db, provider):
    _prepared(db, provider)
    _order(db, 1, 1, "US")
    db.commit()
    out = tools.discover_overview(NS(db=db, shop=SHOP_A, today=SEPT), {})
    assert out["ozet"]["siradaki_zirve"] == {"kelime": "metal farm sign", "kac_ay_sonra": 1, "zirve_aylar": ["Eki", "Kas"]}
    assert [f["kelime"] for f in out["firsatlar"]] == ["metal farm sign big", "metal farm sign mid"]
    assert out["musteri_ulkeleri"]["ulkeler"] == [{"kod": "US", "siparis": 1, "yuzde": 100}]
    assert out["ulke_talebi"]["olculen_pazarlar"][0]["kod"] == "US" and out["ulke_talebi"]["hazirlaniyor"] is True
    assert "discover_overview" in tools.EXECUTORS and "discover_overview" in tools.LABELS and "discover_overview" in tools.LABELS_EN
    assert "discover_overview" in {t["name"] for t in tools.TOOLS}
    assert "discover_overview" in assistant_tools.LISTING_TOOL_NAMES and "discover_overview" in assistant_tools.TOOL_GROUPS["discover"]
    assert "discover" in assistant_tools.listing_groups("müşterilerim hangi ülkelerden alıyor, hangi ülke arıyor?", None)


# ---- çok pazar: öncelik, devre kesici, sorgu sayısı

def test_map_jobs_wait_behind_user_searches(db, provider):
    _prepared(db, provider)
    service.refresh_markets(db)
    service.volumes(db, ["a brand new keyword"])  # kullanıcı isteği: ana pazar, öncelik 0
    first = jobs.claim(db, limit=1)[0]
    assert first.market == "US" and first.priority == 0, "harita işleri (öncelik -1) kullanıcı işinin arkasında bekler"


def _failed_calls(db, market, n=5):
    for _ in range(n):
        db.add(ProviderCall(provider="dataforseo", endpoint="x", market=market, language="en", items=0, cost_usd=0.0, duration_ms=1, ok=False, error="boom", kind="volume"))
    db.commit()


def test_failures_in_extra_markets_do_not_open_the_breaker(db, provider):
    _failed_calls(db, "SK")
    assert worker.breaker_until(db) is None, "yalnızca ek pazar çağrıları hatalı: kullanıcı aramaları durmaz"
    _failed_calls(db, "US")
    assert worker.breaker_until(db) is not None, "ana pazar çağrıları üst üste hatalıysa devre kesici açılır"


def test_country_demand_reads_every_market_with_a_constant_number_of_queries(db, provider):
    from sqlalchemy import event

    _prepared(db, provider)
    provider.markets = ("US",) + tuple(f"X{i}" for i in range(40))
    statements = []
    engine = db.get_bind()
    listener = lambda conn, cursor, statement, *a: statements.append(statement)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        out = overview.country_demand(db, TERMS)
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert len(out["rows"]) == 41 and out["rows"][0]["market"] == "US"
    assert len(statements) <= 5, f"pazar sayısından bağımsız sabit sorgu: {len(statements)}"


def test_preparing_ends_even_when_small_markets_never_return_data(db, provider):
    _prepared(db, provider, markets=("US", "GB", "MT"))
    provider.no_data = set(TERMS)  # sağlayıcı yeni pazarlarda hiçbir kelime için hacim dönmüyor
    service.refresh_markets(db)
    assert overview.country_demand(db, TERMS)["preparing"] is True, "işler sırada"
    _run_all(db)
    assert overview.country_demand(db, TERMS)["preparing"] is True, "ek pazarda hiç ölçüm yok: hâlâ hazırlanıyor sayılır"
    provider.no_data = {"metal farm sign tiny"}
    db.query(KeywordMetric).filter(KeywordMetric.market != "US").update({"expires_at": dt.datetime.utcnow() - dt.timedelta(days=1)})  # boş ölçümler eskidi: yeniden istenir
    db.commit()
    service.refresh_markets(db)
    _run_all(db)
    assert overview.country_demand(db, TERMS)["preparing"] is False, "bir ek pazarda ölçüm var ve sırada iş yok: hazır (MT'de veri olmaması beklemeyi uzatmaz)"

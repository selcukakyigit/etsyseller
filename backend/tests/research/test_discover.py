"""Keşfet: arama, bantlar (ham sayı sızmaz), kalabalık, kaydetme, çalışma alanı yalıtımı, günlük kota, asistan araçları, HTTP uç noktaları."""
import json
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

from app.assistant.toolsets import research as tools
from app.core import app_settings
from app.core.db import SessionLocal, get_db
from app.core.deps import get_current_user
from app.listings.models import ListingCache
from app.research import discover, worker
from app.research.models import ResearchJob, SuggestionExposure
from app.shops.deps import get_owned_shop

SHOP_A = NS(id=1, workspace_id=1)
SHOP_B = NS(id=2, workspace_id=2)


def _research(db, shop, seed="metal farm sign"):
    assert discover.search(db, shop, seed).status == "pending"
    worker.run_once(db)
    return discover.search(db, shop, seed)


def test_first_search_is_pending_then_ready_with_bands_only(db, provider):
    db.add(ListingCache(shop_id=1, listing_id=11, raw_json=json.dumps({"tags": ["Metal Farm Sign Custom"]}), title="t"))
    db.commit()
    assert discover.search(db, SHOP_A, "Metal  Farm Sign").status == "pending" and provider.calls == []
    discover.search(db, SHOP_A, "metal farm sign")
    assert db.query(ResearchJob).count() == 1  # tekrar aranırsa yeni iş açılmaz
    worker.run_once(db)
    result = discover.search(db, SHOP_A, "metal farm sign")
    assert result.status == "ready" and result.seed_item.demand == "medium" and result.seed_item.intent == "commercial"
    by = {i.term: i for i in result.items}
    assert by["metal farm sign big"].demand == "high" and by["metal farm sign tiny"].demand == "low"
    assert by["metal farm sign custom"].intent is None, "bilinmeyen niyet gösterilmez"
    assert by["metal farm sign custom"].mine is True and by["metal farm sign big"].mine is False


def test_results_carry_google_metrics_but_no_platform_internal_counts(db, provider):
    _research(db, SHOP_A)
    db.add(SuggestionExposure(term="metal farm sign big", shops=20))
    db.commit()
    result = discover.search(db, SHOP_A, "metal farm sign")
    seed = result.seed_item
    assert (seed.volume, seed.cpc, seed.competition) == (210, 0.84, 100)
    assert len(seed.monthly) == 12 and seed.trend_pct == 100  # son 3 ay (200) / ilk 3 ay (100)
    by = {i.term: i for i in result.items}
    assert by["metal farm sign big"].volume == 5000 and by["metal farm sign big"].competition == 20 and by["metal farm sign big"].monthly == []
    assert result.total_volume == 5000 + 300 + 20 + 80
    payload = json.dumps(result.as_dict())
    assert "crowd_shops" not in payload and '"shops"' not in payload, "platform içi sayılar gösterilmez, yalnızca kalabalık işareti"
    assert by["metal farm sign big"].crowded is True


def test_trend_pct_edge_cases():
    assert discover.trend_pct([]) is None and discover.trend_pct([5] * 5) is None
    assert discover.trend_pct([0, 0, 0, 5, 5, 5]) is None  # başlangıç 0: oran tanımsız
    assert discover.trend_pct([100, 100, 100, 50, 50, 50]) == -50


def test_crowded_flag_comes_from_the_shared_counter(db, provider):
    _research(db, SHOP_A)
    db.add(SuggestionExposure(term="metal farm sign big", shops=20))
    db.commit()
    assert {i.term: i.crowded for i in discover.search(db, SHOP_A, "metal farm sign").items}["metal farm sign big"] is True


def test_empty_provider_answer_is_not_paid_for_again(db, provider):
    provider.empty_seeds = {"zzz nothing"}
    discover.search(db, SHOP_A, "zzz nothing")
    worker.run_once(db)
    assert discover.search(db, SHOP_A, "zzz nothing").status == "empty"
    jobs_before = db.query(ResearchJob).count()
    discover.search(db, SHOP_A, "zzz nothing")
    assert db.query(ResearchJob).count() == jobs_before and provider.count("suggest") == 1


def test_invalid_seed(db, provider):
    assert discover.search(db, SHOP_A, "x" * 200).status == "invalid"
    assert discover.search(db, SHOP_A, "   ").status == "invalid"


def test_saved_keywords_are_isolated_per_workspace(db, provider):
    _research(db, SHOP_A)
    assert discover.save(db, SHOP_A, 7, ["Metal Farm Sign Big", "metal farm sign mid", "metal farm sign big"], "Farm") == 2
    assert discover.save(db, SHOP_A, 7, ["metal farm sign big"], "Farm") == 0  # zaten kayıtlı
    assert discover.save(db, SHOP_A, 7, ["metal farm sign tiny"], "") == 1
    view = discover.saved(db, SHOP_A, "Farm")
    assert view.total == 2 and {c["name"]: c["count"] for c in view.collections} == {"": 1, "Farm": 2}
    assert next(i for i in view.items if i.term == "metal farm sign big").demand == "high"
    other = discover.saved(db, SHOP_B)
    assert other.total == 0 and other.collections == []
    assert all(not i.saved for i in discover.search(db, SHOP_B, "metal farm sign").items), "kayıt işareti başka çalışma alanına sızmamalı"
    assert discover.unsave(db, SHOP_B, ["metal farm sign big"], "Farm") == 0
    assert discover.unsave(db, SHOP_A, ["metal farm sign big"], "Farm") == 1


def test_daily_new_search_allowance(db, provider):
    _research(db, SHOP_A)
    app_settings.set_many(db, {"research_shop_daily_searches": 2})
    for seed in ("alpha sign", "beta sign"):
        assert discover.search(db, SHOP_B, seed).status == "pending"
    blocked = discover.search(db, SHOP_B, "gamma sign")
    assert blocked.status == "refused" and blocked.refused == "shop_searches"
    assert discover.search(db, SHOP_B, "metal farm sign").status == "ready", "havuzda hazır arama kotaya takılmaz"


def test_assistant_tools_use_the_same_functions_and_hide_raw_numbers(db, provider):
    ctx = NS(db=db, shop=SHOP_A, user_id=7)
    assert tools.research_keywords(ctx, {"seed": ""})["error"]
    assert tools.research_keywords(ctx, {"seed": "metal farm sign"})["durum"] == "hazirlaniyor"
    worker.run_once(db)
    out = tools.research_keywords(ctx, {"seed": "metal farm sign"})
    assert out["durum"] == "hazir" and out["tohum"]["talep"] == "orta" and any(o.get("talep") == "yüksek" for o in out["oneriler"])
    assert out["tohum"]["google_aylik_arama"] == 210 and out["tohum"]["cpc_usd"] == 0.84 and out["tohum"]["yillik_egilim_yuzde"] == 100
    assert out["oneriler"][0]["google_aylik_arama"] == 5000, "en çok aranan önce"
    assert not any("etsy_ilan_sayisi" in o for o in out["oneriler"]), "Etsy ölçümü yalnızca istenirse"
    assert "shops" not in json.dumps(out) and "crowd_shops" not in json.dumps(out)
    assert tools.save_keywords(ctx, {"terms": ["metal farm sign big"], "collection": "Araç"})["eklenen"] == 1
    saved = tools.saved_keywords(ctx, {"collection": "Araç"})
    assert saved["toplam"] == 1 and saved["kelimeler"][0]["talep"] == "yüksek"
    assert tools.save_keywords(ctx, {"terms": ["metal farm sign big"], "collection": "Araç", "remove": True})["silinen"] == 1


def test_questions_are_a_separate_lazy_job_with_their_own_list(db, provider):
    _research(db, SHOP_A)  # normal liste
    assert provider.count("questions") == 0, "sorular yalnızca istenince çekilir"
    first = discover.search(db, SHOP_A, "metal farm sign", "questions")
    assert first.status == "pending"
    worker.run_once(db)
    questions = discover.search(db, SHOP_A, "metal farm sign", "questions")
    assert questions.status == "ready" and questions.mode == "questions"
    assert sorted(i.term for i in questions.items) == ["how to use metal farm sign", "what is metal farm sign"]
    assert provider.count("questions") == 1
    normal = discover.search(db, SHOP_A, "metal farm sign")
    assert not any(i.term.startswith(("how to", "what is")) for i in normal.items), "sorular normal listeye karışmaz"
    jobs_before = db.query(ResearchJob).count()
    discover.search(db, SHOP_A, "metal farm sign", "questions")
    assert db.query(ResearchJob).count() == jobs_before, "soru listesi de havuzdan gelir, tekrar ödenmez"


def test_result_says_when_the_data_was_measured(db, provider):
    result = _research(db, SHOP_A)
    assert result.measured_at and result.measured_at.endswith("Z")


def test_suggestions_do_not_append_rows_for_terms_that_already_have_fresh_metrics(db, provider):
    from app.research.models import KeywordMetric

    _research(db, SHOP_A, "metal farm sign")
    rows_after_first = db.query(KeywordMetric).count()
    provider.volume = 999
    # farklı tohum, aynı öneri kelimeleri üretmez; ama aynı tohum zorla yenilenirse taze kelimeler için yeni satır eklenmemeli
    job = db.query(ResearchJob).filter(ResearchJob.kind == "suggest").one()
    job.status, job.finished_at = "queued", None
    db.commit()
    worker.run_once(db)
    assert db.query(KeywordMetric).count() == rows_after_first + 1, "yalnızca tohumun kendi ölçümü yenilenir"


@pytest.fixture
def client(db, provider):
    from app import main

    def _db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[get_db] = _db
    main.app.dependency_overrides[get_current_user] = lambda: NS(id=5, email="a@b.c", is_admin=False)
    main.app.dependency_overrides[get_owned_shop] = lambda: SHOP_A
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_etsy_competition_is_measured_on_request_and_limited(db, provider, monkeypatch):
    from app.keywords import competition

    calls = []
    monkeypatch.setattr(competition, "_count", lambda phrase: calls.append(phrase) or len(phrase) * 100)
    ctx = NS(db=db, shop=SHOP_A, user_id=7)
    _research(db, SHOP_A)
    out = tools.research_keywords(ctx, {"seed": "metal farm sign", "etsy_competition": True})
    first = out["oneriler"][0]
    assert first["etsy_ilan_sayisi"] == len(first["kelime"]) * 100 and len(calls) == 4  # yalnızca 4 öneri ölçülür (tohum değil)
    assert discover.etsy_results(SHOP_B, ["a b"] * 3) == {"a b": 300}  # tekrarlar tek kelime
    assert discover.etsy_results(SHOP_B, [" ", ""]) == {}
    shop_c = NS(id=3, workspace_id=3)
    for _ in range(12):
        assert discover.etsy_results(shop_c, ["alpha"]) is not None
    assert discover.etsy_results(shop_c, ["alpha"]) is None, "mağaza başına ölçüm sınırı"


def test_http_endpoints(client, db):
    assert client.get("/api/shops/1/discover/search", params={"q": "farm sign"}).status_code == 200
    worker.run_once(db)
    body = client.get("/api/shops/1/discover/search", params={"q": "farm sign"}).json()
    assert body["status"] == "ready" and body["seed_item"]["demand"] == "medium"
    assert body["seed_item"]["volume"] == 210 and len(body["seed_item"]["monthly"]) == 12 and body["total_volume"] == 5400
    assert client.get("/api/shops/1/discover/search", params={"q": ""}).status_code == 422
    assert client.get("/api/shops/1/discover/search", params={"q": "farm sign", "mode": "bogus"}).status_code == 422
    assert client.get("/api/shops/1/discover/search", params={"q": "farm sign", "mode": "questions"}).json()["mode"] == "questions"
    assert client.post("/api/shops/1/discover/saved", json={"terms": ["farm sign big"], "collection": "A"}).json() == {"added": 1}
    saved = client.get("/api/shops/1/discover/saved").json()
    assert saved["total"] == 1 and saved["collections"] == [{"name": "A", "count": 1}]
    assert client.post("/api/shops/1/discover/saved", json={"terms": [], "collection": ""}).status_code == 422
    assert client.post("/api/shops/1/discover/saved/remove", json={"terms": ["farm sign big"], "collection": "A"}).json() == {"removed": 1}
    assert client.post("/api/shops/1/discover/etsy-results", json={"terms": []}).status_code == 422
    assert client.post("/api/shops/1/discover/etsy-results", json={"terms": ["x"] * 21}).status_code == 422

"""Etsy ilk 20 sonuç analizi: hesaplar, önbellek, ölçüm sınırı, uç nokta ve asistan aracı."""
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

from app.assistant.toolsets import research as tools
from app.core.db import SessionLocal, get_db
from app.core.deps import get_current_user
from app.research import etsy_top
from app.shops.deps import get_owned_shop

NOW = 1_800_000_000.0
DAY = 86400


def listing(i, favs, views=100, age_days=200, price=2000, tags=("metal wall art", "home decor"), currency="USD"):
    return {
        "listing_id": i, "title": f"Listing {i}", "url": f"https://etsy.test/{i}", "price": {"amount": price, "divisor": 100, "currency_code": currency},
        "num_favorers": favs, "views": views, "original_creation_timestamp": NOW - age_days * DAY, "tags": list(tags), "shop_id": 100 + i, "is_personalizable": i % 2 == 0,
    }


def test_summarize_counts_proven_listings_and_ignores_median_favorites():
    results = [listing(i, f) for i, f in enumerate([0, 0, 0, 0, 3, 9, 10, 25, 50, 400])]
    out = etsy_top.summarize("metal wall art", {"count": 775_000, "results": results}, now=NOW)
    assert out["total"] == 775_000 and out["sample"] == 10
    assert out["proven"] == 4 and out["strong"] == 2  # 10, 25, 50, 400 / 50, 400
    assert "strength" not in out, "API örneğinden rekabet gücü hükmü üretilmez"
    assert out["favorites"]["max"] == 400
    assert out["price"] == {"p25": 20.0, "median": 20.0, "p75": 20.0}
    assert out["new_share"] == 0.0 and out["age_days_median"] == 200
    assert out["top_tags"][0] == {"tag": "metal wall art", "count": 10}


def test_new_share_and_empty_sample():
    few = etsy_top.summarize("a b", {"count": 1, "results": [listing(i, 0, age_days=10) for i in range(5)]}, now=NOW)
    assert few["new_share"] == 1.0 and few["proven"] == 0
    many = etsy_top.summarize("a b", {"count": 1, "results": [listing(i, 20) for i in range(12)]}, now=NOW)
    assert many["proven"] == 12 and many["new_share"] == 0.0
    empty = etsy_top.summarize("a b", {"count": 0, "results": []}, now=NOW)
    assert empty["sample"] == 0 and empty["new_share"] is None


def test_price_uses_the_most_common_currency_only():
    mixed = [listing(1, 0, price=1000), listing(2, 0, price=3000), listing(3, 0, price=900000, currency="JPY")]
    out = etsy_top.summarize("a b", {"count": 3, "results": mixed}, now=NOW)
    assert out["currency"] == "USD" and out["price"]["median"] == 20.0, "farklı para birimi fiyat bandını bozmamalı"


@pytest.fixture
def etsy_calls(monkeypatch):
    etsy_top._cache.clear()
    etsy_top._limiter._hits.clear()
    calls = []

    def fake(keywords, limit=50):
        calls.append(keywords)
        return {"count": 12345, "results": [listing(i, i * 5, age_days=300) for i in range(6)]}

    monkeypatch.setattr("app.taxonomy.service.search_active_listings", fake)
    monkeypatch.setattr("app.taxonomy.service.listing_thumbnails", lambda ids: {i: f"https://img.test/{i}.jpg" for i in ids if i != 3})
    return calls


def test_fetch_caches_and_limits_per_shop(etsy_calls):
    first = etsy_top.fetch(1, "Metal  Wall Art")
    again = etsy_top.fetch(2, "metal wall art")  # başka mağaza, aynı arama: önbellekten, ölçüm hakkından düşmez
    assert first["term"] == "metal wall art" and again is first and len(etsy_calls) == 1
    assert etsy_top.fetch(1, "x" * 200) == {} and etsy_top.fetch(1, "   ") == {}, "geçersiz terim istek atmaz"
    for i in range(20):
        assert etsy_top.fetch(3, f"phrase number {i}") is not None
    assert etsy_top.fetch(3, "one more phrase") is None, "mağaza başına ölçüm sınırı"


def test_listings_carry_thumbnails_and_survive_missing_ones(etsy_calls, monkeypatch):
    out = etsy_top.fetch(1, "metal wall art")
    images = {l["listing_id"]: l["image"] for l in out["listings"]}
    assert images[1] == "https://img.test/1.jpg" and images[3] is None, "resmi olmayan ilan resimsiz kalır"

    etsy_top._cache.clear()

    def boom(ids):
        raise RuntimeError("etsy down")

    monkeypatch.setattr("app.taxonomy.service.listing_thumbnails", boom)
    again = etsy_top.fetch(1, "metal wall art")
    assert len(again["listings"]) == 6 and all(l["image"] is None for l in again["listings"]), "resim hatası analizi bozmaz"


def test_assistant_tool_labels_the_data_as_etsy(db, etsy_calls):
    ctx = NS(db=db, shop=NS(id=1, workspace_id=1), user_id=7)
    assert tools.etsy_top_results(ctx, {"term": ""})["error"]
    out = tools.etsy_top_results(ctx, {"term": "metal wall art"})
    assert out["etsy_toplam_ilan"] == 12345 and "rekabet_gostergesi" not in out, "asistan rekabet hükmü vermez"
    assert "DEĞİL" in out["not"], "örnek olduğu, sitedeki ilk sayfa olmadığı söylenir"
    assert "ETSY verisi" in out["not"] and out["en_sik_etiketler"][0].startswith("metal wall art (6/20)")


def test_http_endpoint(db, etsy_calls):
    from app import main

    def _db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    main.app.dependency_overrides[get_db] = _db
    main.app.dependency_overrides[get_current_user] = lambda: NS(id=5, email="a@b.c", is_admin=False)
    main.app.dependency_overrides[get_owned_shop] = lambda: NS(id=1, workspace_id=1)
    try:
        client = TestClient(main.app)
        body = client.post("/api/shops/1/discover/etsy-top", json={"term": "metal wall art"}).json()
        assert body["limited"] is False and body["analysis"]["total"] == 12345 and len(body["analysis"]["listings"]) == 6
        assert client.post("/api/shops/1/discover/etsy-top", json={"term": ""}).status_code == 422
    finally:
        main.app.dependency_overrides.clear()


def test_summarize_reports_which_categories_the_competitors_sit_in():
    results = [{**listing(i, 1), "taxonomy_id": 1027 if i < 6 else 129 if i < 8 else 1029} for i in range(10)] + [listing(99, 1)]  # sonuncusunun kategori kimliği yok
    out = etsy_top.summarize("metal butterfly", {"count": 100, "results": results}, now=NOW)
    assert out["categories"] == [{"taxonomy_id": 1027, "share": 0.55}, {"taxonomy_id": 129, "share": 0.18}, {"taxonomy_id": 1029, "share": 0.18}]
    assert etsy_top.summarize("x", {"count": 0, "results": []}, now=NOW)["categories"] == []

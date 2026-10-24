"""Keşfet ana ekranı (arama yapılmadan önce): mağazanın kendi etiketleri, yaklaşan sezon, koleksiyonlar; asistan karşılığı."""
import datetime as dt
import json
from types import SimpleNamespace as NS

from app.assistant import tools as assistant_tools
from app.assistant.toolsets import research as tools
from app.listings.models import ListingCache
from app.research import discover, worker
from app.research.models import ResearchJob, SavedKeyword

SHOP = NS(id=1, workspace_id=1)
OTHER = NS(id=2, workspace_id=2)
SEPT = dt.date(2026, 9, 15)  # fake sağlayıcının mevsim profili Ekim-Kasım zirveli


def _listing(db, shop_id, listing_id, tags):
    db.add(ListingCache(shop_id=shop_id, listing_id=listing_id, raw_json=json.dumps({"tags": tags}), title="t"))
    db.commit()


def _research_seed(db):
    discover.search(db, SHOP, "metal farm sign")
    worker.run_once(db)


def test_home_lists_the_shops_own_tags_by_frequency_without_other_shops(db, provider):
    _listing(db, 1, 1, ["Metal Farm Sign", "barn decor"])
    _listing(db, 1, 2, ["metal farm sign", "ranch gate"])
    _listing(db, 2, 3, ["secret competitor tag"])
    view = discover.home(db, SHOP, SEPT)
    assert [i.term for i in view.tags][0] == "metal farm sign", "en sık kullanılan etiket önde"
    assert {i.term for i in view.tags} == {"metal farm sign", "barn decor", "ranch gate"}, "başka mağazanın etiketi sızmaz"
    assert all(i.volume is None for i in view.tags) and view.upcoming == [] and not view.preparing
    assert provider.calls == [] and db.query(ResearchJob).count() == 0, "ölçümü olmayan etiket için hiçbir şey istenmez"


def test_upcoming_season_is_computed_for_measured_tags_and_shown_when_the_peak_is_near(db, provider):
    _listing(db, 1, 1, ["metal farm sign", "metal farm sign tiny", "never researched tag"])
    _research_seed(db)  # tohum 210, "tiny" 20 aylık aramayla ölçüldü
    first = discover.home(db, SHOP, SEPT)
    assert first.preparing and first.upcoming == [], "mevsimsellik kuyruğa alındı, henüz hazır değil"
    jobs = [j.idem_key for j in db.query(ResearchJob).filter(ResearchJob.kind == "season")]
    assert jobs == ["season:US:en:metal farm sign"], "yalnızca ölçülmüş ve yeterince aranan etiket (tiny 20 < 100, ölçülmemiş etiket istenmez)"
    worker.run_once(db)
    done = discover.home(db, SHOP, SEPT)
    assert not done.preparing
    assert [(u["term"], u["in_months"], u["peak_months"]) for u in done.upcoming] == [("metal farm sign", 1, [10, 11])], "Eylül'den 1 ay sonra zirve"
    assert provider.count("season") == 1
    discover.home(db, SHOP, SEPT)
    assert provider.count("season") == 1, "aynı etiket için tekrar çağrı yok"


def test_upcoming_window_and_ordering():
    assert discover.months_until_peak([10, 11], dt.date(2026, 10, 3)) == 0, "bu ay zirvede"
    assert discover.months_until_peak([10, 11], dt.date(2026, 8, 30)) == 2
    assert discover.months_until_peak([10, 11], dt.date(2026, 6, 1)) is None, "ufuktan (3 ay) uzak"
    assert discover.months_until_peak([1, 2], dt.date(2026, 11, 20)) == 2, "yıl sınırını aşar"


def test_far_peak_is_not_upcoming(db, provider):
    _listing(db, 1, 1, ["metal farm sign"])
    _research_seed(db)
    discover.home(db, SHOP, SEPT)
    worker.run_once(db)
    assert discover.home(db, SHOP, dt.date(2026, 3, 1)).upcoming == [], "Ekim zirvesi Mart'ta yaklaşan değil"


def test_season_fill_is_capped_per_visit(db, provider, monkeypatch):
    _listing(db, 1, 1, ["metal farm sign", "metal farm sign big", "metal farm sign mid"])
    _research_seed(db)
    monkeypatch.setattr(discover, "SEASON_FILL_PER_VISIT", 2)
    discover.home(db, SHOP, SEPT)
    assert db.query(ResearchJob).filter(ResearchJob.kind == "season").count() == 2, "bir ziyarette en fazla sınır kadar iş"
    worker.run_once(db)
    worker.run_once(db)
    discover.home(db, SHOP, SEPT)
    assert db.query(ResearchJob).filter(ResearchJob.kind == "season").count() == 3, "kalan etiket sonraki ziyarette"


def test_home_collections_are_workspace_scoped(db, provider):
    db.add_all([SavedKeyword(workspace_id=1, created_by=1, term="a b", collection="Farm"), SavedKeyword(workspace_id=1, created_by=1, term="c d", collection="Farm"), SavedKeyword(workspace_id=2, created_by=9, term="x y", collection="Gizli")])
    db.commit()
    assert discover.home(db, SHOP, SEPT).collections == [{"name": "Farm", "count": 2}]
    assert discover.home(db, OTHER, SEPT).collections == [{"name": "Gizli", "count": 1}]


def test_assistant_upcoming_seasons_uses_the_same_logic(db, provider):
    _listing(db, 1, 1, ["metal farm sign"])
    _research_seed(db)
    ctx = NS(db=db, shop=SHOP, user_id=7, today=SEPT)
    first = tools.upcoming_seasons(ctx, {})
    assert first["hazirlaniyor"] is True and first["yaklasan_sezon"] == []
    worker.run_once(db)
    out = tools.upcoming_seasons(ctx, {})
    assert out["yaklasan_sezon"] == [{"kelime": "metal farm sign", "zirve_aylar": ["Eki", "Kas"], "kac_ay_sonra": 1, "google_aylik_arama": 210}]
    assert "1-2 ay" in out["not"] and "hazirlaniyor" not in out
    assert "upcoming_seasons" in {t["name"] for t in assistant_tools.TOOLS} and "upcoming_seasons" in assistant_tools.EXECUTORS
    assert "upcoming_seasons" in assistant_tools.LISTING_TOOL_NAMES and "upcoming_seasons" in assistant_tools.TOOL_GROUPS["discover"]
    assert "upcoming_seasons" in assistant_tools.TOOL_LABELS and "upcoming_seasons" in assistant_tools.TOOL_LABELS_EN


def test_home_endpoint(db, provider):
    from fastapi.testclient import TestClient

    from app import main
    from app.core.db import SessionLocal, get_db
    from app.core.deps import get_current_user
    from app.shops.deps import get_owned_shop

    _listing(db, 1, 1, ["metal farm sign"])

    def _db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    main.app.dependency_overrides[get_db] = _db
    main.app.dependency_overrides[get_current_user] = lambda: NS(id=5, email="a@b.c", is_admin=False)
    main.app.dependency_overrides[get_owned_shop] = lambda: SHOP
    try:
        body = TestClient(main.app).get("/api/shops/1/discover/home").json()
        assert [t["term"] for t in body["tags"]] == ["metal farm sign"] and body["upcoming"] == [] and body["collections"] == [] and body["preparing"] is False
    finally:
        main.app.dependency_overrides.clear()

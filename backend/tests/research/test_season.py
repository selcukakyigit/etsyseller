"""Mevsimsellik: profil hesabı, kuyruk/önbellek, Keşfet'te tohum için görünmesi, asistan çıktısı."""
import datetime as dt
from types import SimpleNamespace as NS

from app.assistant.toolsets import research as tools
from app.research import discover, service, worker
from app.research.models import KeywordSeason, ResearchJob
from app.research.providers.dataforseo import season_profile

SHOP = NS(id=1, workspace_id=1)


def weekly(values_by_month, years=5, start_year=2021):
    """Her ay için haftalık noktalar: values_by_month[ay-1] değeri o ayın her haftasında."""
    points = []
    day = dt.date(start_year, 1, 4)
    end = dt.date(start_year + years, 1, 1)
    while day < end:
        points.append((day, float(values_by_month[day.month - 1])))
        day += dt.timedelta(days=7)
    return points


def test_profile_peaks_at_100_and_averages_across_years():
    profile, years = season_profile(weekly([5, 5, 5, 5, 5, 5, 5, 8, 15, 40, 100, 80]))
    assert profile[10] == 100 and profile[11] == 80 and profile[0] == 5 and years >= 5
    assert len(profile) == 12 and max(profile) == 100


def test_profile_needs_enough_history_and_signal():
    assert season_profile(weekly([10] * 12, years=1)) is None, "24 aydan kısa geçmişte profil çıkarılmaz"
    assert season_profile(weekly([0] * 12)) is None, "ilgi hep sıfırsa (düşük hacim) profil yok"
    assert season_profile([(d, None) for d, _ in weekly([10] * 12)]) is None
    holes = [(d, v) for d, v in weekly([10] * 12) if d.month != 6]
    assert season_profile(holes) is None, "bir ay hiç yoksa profil güvenilmez"


def test_season_view_flags():
    seasonal = service.season_view([10, 10, 12, 15, 20, 25, 30, 40, 60, 100, 90, 50])
    assert seasonal.seasonal and seasonal.peak_months == [10, 11]
    flat = service.season_view([90, 95, 100, 92, 96, 94, 91, 97, 93, 98, 99, 95])
    assert not flat.seasonal and len(flat.peak_months) == 12
    assert service.season_view(None).monthly == [] and service.season_view([1, 2]).monthly == []


def test_service_queues_once_serves_from_pool_and_caches_empty_profiles(db, provider):
    first = service.seasonality(db, "christmas ornaments", shop_id=1)
    assert first.pending and not first.monthly and provider.calls == []
    service.seasonality(db, "christmas ornaments", shop_id=1)
    assert db.query(ResearchJob).filter(ResearchJob.kind == "season").count() == 1, "tekrar iş açılmaz"
    worker.run_once(db)
    ready = service.seasonality(db, "christmas ornaments")
    assert not ready.pending and ready.peak_months == [10, 11] and ready.seasonal
    service.seasonality(db, "christmas ornaments")
    assert provider.count("season") == 1, "TTL içinde yeniden istenmez"

    provider.season_monthly = None  # profil çıkarılamayan kelime
    service.seasonality(db, "obscure item")
    worker.run_once(db)
    empty = service.seasonality(db, "obscure item")
    assert not empty.pending and empty.monthly == [] and provider.count("season") == 2, "boş sonuç da önbelleğe alınır, tekrar ödenmez"
    assert db.query(KeywordSeason).count() == 2


def test_discover_shows_season_for_the_seed_and_keeps_polling_while_pending(db, provider):
    assert discover.search(db, SHOP, "metal farm sign").status == "pending"
    worker.run_once(db)
    first = discover.search(db, SHOP, "metal farm sign")
    assert first.status == "ready" and first.season["pending"] and first.stale, "mevsimsellik sürerken ekran yoklamaya devam eder"
    worker.run_once(db)
    done = discover.search(db, SHOP, "metal farm sign")
    assert not done.stale and done.season["monthly"] and done.season["peak_months"] == [10, 11] and done.season["seasonal"]
    questions = discover.search(db, SHOP, "metal farm sign", "questions")
    assert questions.season is None, "mevsimsellik yalnızca tüm kelimeler görünümünde"


def test_assistant_tool_includes_the_season(db, provider):
    ctx = NS(db=db, shop=SHOP, user_id=7)
    tools.research_keywords(ctx, {"seed": "metal farm sign"})
    worker.run_once(db)
    tools.research_keywords(ctx, {"seed": "metal farm sign"})
    worker.run_once(db)
    out = tools.research_keywords(ctx, {"seed": "metal farm sign"})
    season = out["mevsimsellik"]
    assert season["mevsimsel"] is True and season["zirve_aylar"] == ["Eki", "Kas"] and season["aylik_ilgi_0_100"]["Eki"] == 100
    assert "listing" in season["not"]


def test_season_endpoint_for_any_keyword(db, provider):
    from fastapi.testclient import TestClient

    from app import main
    from app.core.db import SessionLocal, get_db
    from app.core.deps import get_current_user
    from app.shops.deps import get_owned_shop

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
        client = TestClient(main.app)
        first = client.get("/api/shops/1/discover/season", params={"q": "christmas ornaments"}).json()["season"]
        assert first["pending"] and first["monthly"] == []
        worker.run_once(db)
        done = client.get("/api/shops/1/discover/season", params={"q": "Christmas  Ornaments"}).json()["season"]
        assert not done["pending"] and done["peak_months"] == [10, 11] and len(done["monthly"]) == 12
        assert client.get("/api/shops/1/discover/season", params={"q": "x" * 200}).status_code == 422
        assert client.get("/api/shops/1/discover/season", params={"q": "  "}).json()["season"] is None
    finally:
        main.app.dependency_overrides.clear()


def test_items_carry_the_last_month_of_their_series(db, provider):
    discover.search(db, SHOP, "metal farm sign")
    worker.run_once(db)
    res = discover.search(db, SHOP, "metal farm sign")
    assert res.seed_item.monthly and res.seed_item.last_month == "2026-10", "ay adları bu son aydan geriye sayılır"
    assert all(i.last_month == "2026-10" for i in res.items if i.monthly)


def test_rarely_searched_keyword_skips_the_paid_season_call(db, provider, monkeypatch):
    from app.research import policy

    original = policy.get
    monkeypatch.setattr(policy, "get", lambda name: 500 if name == "research_season_min_volume" else original(name))  # fake sağlayıcının tohum hacmi 210
    assert discover.search(db, SHOP, "metal farm sign").status == "pending"
    worker.run_once(db)
    res = discover.search(db, SHOP, "metal farm sign")
    assert res.season["too_rare"] and res.season["min_volume"] == 500 and not res.season["pending"] and res.season["monthly"] == []
    assert not res.stale, "ek ölçüm beklenmediği için ekran yoklamayı bırakır"
    assert db.query(ResearchJob).filter(ResearchJob.kind == "season").count() == 0, "iş açılmaz"
    worker.run_once(db)
    assert provider.count("season") == 0, "sağlayıcıya (ücretli) çağrı gitmez"

    tool = tools.research_keywords(NS(db=db, shop=SHOP, user_id=7), {"seed": "metal farm sign"})
    assert "mevsimsellik" in tool and "hesaplanmadı" in tool["mevsimsellik"]["not"] and "mevsimsel" not in tool["mevsimsellik"]


def test_volume_at_or_above_the_minimum_still_gets_a_season(db, provider, monkeypatch):
    from app.research import policy

    original = policy.get
    monkeypatch.setattr(policy, "get", lambda name: 210 if name == "research_season_min_volume" else original(name))  # tam eşik: elenmez
    discover.search(db, SHOP, "metal farm sign")
    worker.run_once(db)
    res = discover.search(db, SHOP, "metal farm sign")
    assert not res.season["too_rare"] and res.season["pending"]


def test_assistant_keyword_detail_gives_the_monthly_series_and_season(db, provider):
    from app.assistant import tools as assistant_tools

    ctx = NS(db=db, shop=SHOP, user_id=7)
    assert tools.keyword_detail(ctx, {"term": ""})["error"]
    assert tools.keyword_detail(ctx, {"term": "never researched phrase"})["durum"] == "olculmemis", "ölçülmemiş kelime önce araştırılmalı"

    tools.research_keywords(ctx, {"seed": "metal farm sign"})
    worker.run_once(db)
    first = tools.keyword_detail(ctx, {"term": "metal farm sign"})
    series = first["aylik_arama_son_12_ay"]
    assert list(series)[0] == "Kas 2025" and list(series)[-1] == "Eki 2026" and len(series) == 12, "ay adları son aydan geriye sayılır"
    assert first["google_aylik_arama"] and "Etsy arama hacmi değil" in first["not"]

    worker.run_once(db)
    done = tools.keyword_detail(ctx, {"term": "Metal  Farm Sign"})
    assert done["mevsimsellik"]["zirve_aylar"] == ["Eki", "Kas"] and done["mevsimsellik"]["mevsimsel"] is True

    # aynı biçimlendirme research_keywords'te de kullanılır (ikinci uygulama yok)
    assert tools.research_keywords(ctx, {"seed": "metal farm sign"})["mevsimsellik"]["zirve_aylar"] == ["Eki", "Kas"]


def test_assistant_research_can_refresh_like_the_screen(db, provider):
    ctx = NS(db=db, shop=SHOP, user_id=7)
    tools.research_keywords(ctx, {"seed": "metal farm sign"})
    worker.run_once(db)
    before = provider.count("suggest")
    tools.research_keywords(ctx, {"seed": "metal farm sign"})
    worker.run_once(db)
    assert provider.count("suggest") == before, "refresh olmadan havuzdan okunur, sağlayıcıya gidilmez"
    tools.research_keywords(ctx, {"seed": "metal farm sign", "refresh": True})
    worker.run_once(db)
    assert provider.count("suggest") == before + 1, "refresh=true yeniden araştırır (ekrandaki 'Yeniden araştır' ile aynı)"


def test_keyword_detail_is_registered_everywhere_the_assistant_needs_it():
    from app.assistant import tools as t

    assert "keyword_detail" in {x["name"] for x in t.TOOLS} and "keyword_detail" in t.EXECUTORS
    assert "keyword_detail" in t.LISTING_TOOL_NAMES and "keyword_detail" in t.TOOL_GROUPS["discover"]
    assert "keyword_detail" in t.TOOL_LABELS and "keyword_detail" in t.TOOL_LABELS_EN

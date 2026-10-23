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

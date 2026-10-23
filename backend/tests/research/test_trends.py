"""Google ilgi endeksi: gruplama (en fazla 5), yıllık değişim, gürültü eşiği, salt-okuma modu, haftalık yenileme."""
from app.insights.models import TrackedKeyword
from app.research import service, worker
from app.research.models import ProviderCall, ResearchJob
from app.research.providers.dataforseo import trend_windows


def test_requests_are_grouped_by_five_and_yoy_is_computed(db, provider):
    result = service.trends(db, list("abcdefg"))
    assert result.pending == 7 and db.query(ResearchJob).count() == 2 and provider.calls == []
    assert worker.run_once(db) == 2
    assert all(len(terms) <= 5 for _, terms in provider.calls)
    trends = service.trends(db, ["a", "b", "c", "d"]).trends
    assert trends["a"].yoy_pct == -50  # 10 vs 20
    assert trends["b"].yoy_pct is None  # geçen yılki ilgi çok düşük: gürültü, hesaplanmaz
    assert trends["c"].yoy_pct == 0
    assert trends["d"].recent is None  # sağlayıcı dönmedi: boş ölçüm
    assert db.query(ProviderCall).count() == 2


def test_fresh_trends_are_not_requested_again(db, provider):
    service.trends(db, ["a"])
    worker.run_once(db)
    service.trends(db, ["a"])
    worker.run_once(db)
    assert provider.count("trend") == 1


def test_read_only_mode_writes_and_queues_nothing(db, provider):
    result = service.trends(db, ["a", "b"], enqueue=False)
    assert result.pending == 0 and not result.trends and db.query(ResearchJob).count() == 0


def test_weekly_refresh_only_covers_active_tracked_searches(db, provider):
    db.add_all([
        TrackedKeyword(shop_id=1, listing_id=1, keyword="zeta", source="auto", active=True),
        TrackedKeyword(shop_id=1, listing_id=2, keyword="inactive one", source="user", active=False),
    ])
    db.commit()
    assert service.refresh_tracked_trends(db) == 1
    assert db.query(ResearchJob).count() == 1


def test_trend_window_math():
    import datetime as dt

    last = dt.date(2026, 10, 18)
    series = [(last - dt.timedelta(weeks=i), 10.0 if i < 13 else (20.0 if 52 <= i < 65 else 5.0)) for i in range(80)]
    assert trend_windows(series) == (10.0, 20.0)
    assert trend_windows([]) == (None, None)
    assert trend_windows([(last, None)]) == (None, None)

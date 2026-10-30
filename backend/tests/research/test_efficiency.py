"""Verimlilik: tek 30 günlük hacim süresi, zorluk/niyetin hacim ölçümünde kaybolmaması, yenileme önceliği, zorluğun Keşfet'e ve asistana çıkması."""
import datetime as dt

from app.core import app_settings
from app.research import discover, policy, pool, service, worker
from app.research.models import KeywordMetric, KeywordTerm, ResearchJob
from app.research.records import MetricRecord
from tests.research.test_discover import SHOP_A, _research


def _days(db, term):
    kw = db.query(KeywordTerm).filter_by(term=term).one()
    m = db.query(KeywordMetric).filter_by(keyword_id=kw.id, is_latest=True).one()
    return (m.expires_at - m.measured_at).total_seconds() / 86400


def test_every_volume_measurement_lives_thirty_days_within_the_jitter(db):
    rows = pool.get_or_create_terms(db, ["hot term", "rare term", "no data term"], "en", "volume")
    records = [MetricRecord("hot term", search_volume=5000), MetricRecord("rare term", search_volume=20)]
    pool.add_metrics(db, rows, records, provider="p", source="google_ads", market="US", language="en", ttl_days=policy.get("research_ttl_volume_days"))
    db.commit()
    for term in ("hot term", "rare term", "no data term"):
        assert abs(_days(db, term) - 30) <= 30 * 0.16, term  # tek süre (Google Ads aylık veridir), ±%15 sapma


def test_volume_measurement_keeps_difficulty_and_intent_from_the_suggestion_row(db):
    rows = pool.get_or_create_terms(db, ["metal sign"], "en", "suggestion")
    pool.add_metrics(db, rows, [MetricRecord("metal sign", search_volume=900, difficulty=42, intent="commercial")], provider="p", source="labs_suggestions", market="US", language="en", ttl_days=21)
    db.commit()  # her sağlayıcı yanıtı ayrı işlemde yazılır (worker)
    pool.add_metrics(db, rows, [MetricRecord("metal sign", search_volume=950, cpc=0.7)], provider="p", source="google_ads", market="US", language="en", ttl_days=21)
    db.commit()
    latest = db.query(KeywordMetric).filter_by(is_latest=True).one()
    assert (latest.search_volume, latest.difficulty, latest.intent, latest.source) == (950, 42, "commercial", "google_ads")
    # sağlayıcı kelimeyi hiç döndürmediyse (boş ölçüm) eski bilgi uydurulmaz
    pool.add_metrics(db, rows, [], provider="p", source="google_ads", market="US", language="en", ttl_days=21)
    db.commit()
    empty = db.query(KeywordMetric).filter_by(is_latest=True).one()
    assert (empty.search_volume, empty.difficulty, empty.intent) == (None, None, None)


def test_daily_refresh_picks_the_most_searched_keywords_first_when_the_cap_is_small(db, provider):
    now = dt.datetime.utcnow()
    rows = pool.get_or_create_terms(db, ["small one", "big one", "mid one"], "en", "volume")
    for term, volume in (("small one", 50), ("big one", 9000), ("mid one", 400)):
        db.add(KeywordMetric(keyword_id=rows[term].id, provider="p", source="google_ads", market="US", language="en", search_volume=volume, measured_at=now - dt.timedelta(days=60), expires_at=now - dt.timedelta(days=1)))
    pool.touch(db, [r.id for r in rows.values()])
    app_settings.set_many(db, {"research_refresh_per_day": 2})
    db.commit()
    assert service.refresh_stale(db) == 2
    worker.run_once(db)
    assert sorted(provider.calls[0][1]) == ["big one", "mid one"]


def test_difficulty_reaches_the_discover_screen_and_the_assistant(db, provider):
    from app.assistant.toolsets import research as tools

    result = _research(db, SHOP_A)
    assert result.seed_item.difficulty is None  # sahte sağlayıcı zorluk vermiyor: uydurulmaz
    kw = db.query(KeywordTerm).filter_by(term="metal farm sign big").one()
    db.query(KeywordMetric).filter_by(keyword_id=kw.id).update({"difficulty": 61})
    db.commit()
    again = discover.search(db, SHOP_A, "metal farm sign")
    by = {i.term: i for i in again.items}
    assert by["metal farm sign big"].difficulty == 61 and by["metal farm sign mid"].difficulty is None
    assert tools._item(by["metal farm sign big"])["seo_zorlugu_0_100"] == 61
    assert "seo_zorlugu_0_100" not in tools._item(by["metal farm sign mid"])


def test_scheduled_refresh_jobs_do_nothing_when_auto_refresh_is_off_but_the_admin_button_still_works(db, provider, monkeypatch):
    from app.jobs import research as jobs_research

    rows = pool.get_or_create_terms(db, ["old one"], "en", "volume")
    old = dt.datetime.utcnow() - dt.timedelta(days=60)
    db.add(KeywordMetric(keyword_id=rows["old one"].id, provider="p", source="google_ads", market="US", language="en", search_volume=100, measured_at=old, expires_at=old + dt.timedelta(days=21)))
    pool.touch(db, [rows["old one"].id])
    db.commit()
    monkeypatch.setattr(jobs_research, "SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)

    app_settings.set_many(db, {"research_auto_refresh": False})
    jobs_research.refresh_stale()
    jobs_research.warm_own_tags()
    jobs_research.refresh_trends()
    assert db.query(ResearchJob).count() == 0  # anahtar kapalı: hiçbir iş kuyruğa girmez

    assert service.refresh_stale(db) == 1  # yönetici düğmesi aynı işlevi çağırır, anahtardan etkilenmez
    app_settings.set_many(db, {"research_auto_refresh": True})
    assert db.query(ResearchJob).count() == 1


def test_admin_refresh_due_endpoint_queues_expired_used_keywords(db, provider):
    from types import SimpleNamespace as NS

    from fastapi.testclient import TestClient

    from app import main
    from app.admin.deps import admin_only
    from app.core.db import SessionLocal, get_db

    rows = pool.get_or_create_terms(db, ["old one", "unused one"], "en", "volume")
    old = dt.datetime.utcnow() - dt.timedelta(days=60)
    for kw in rows.values():
        db.add(KeywordMetric(keyword_id=kw.id, provider="p", source="google_ads", market="US", language="en", search_volume=100, measured_at=old, expires_at=old + dt.timedelta(days=21)))
    pool.touch(db, [rows["old one"].id])
    db.commit()

    def _db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[get_db] = _db
    main.app.dependency_overrides[admin_only] = lambda: NS(id=1, email="a@b.c", is_admin=True)
    try:
        out = TestClient(main.app).post("/api/admin/research/keywords/refresh-due")
    finally:
        main.app.dependency_overrides.clear()
    assert out.status_code == 200 and out.json() == {"queued": 1}  # kullanılmayan kelimeye para harcanmaz

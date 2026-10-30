"""Verimlilik: hacme göre kademeli yenileme süresi, zorluk/niyetin hacim ölçümünde kaybolmaması, yenileme önceliği, zorluğun Keşfet'e ve asistana çıkması."""
import datetime as dt

from app.core import app_settings
from app.research import discover, policy, pool, service, worker
from app.research.models import KeywordMetric, KeywordTerm
from app.research.records import MetricRecord
from tests.research.test_discover import SHOP_A, _research


def _days(db, term):
    kw = db.query(KeywordTerm).filter_by(term=term).one()
    m = db.query(KeywordMetric).filter_by(keyword_id=kw.id, is_latest=True).one()
    return (m.expires_at - m.measured_at).total_seconds() / 86400


def test_ttl_follows_volume_tiers_within_the_jitter(db):
    rows = pool.get_or_create_terms(db, ["hot term", "mid term", "rare term", "no data term"], "en", "volume")
    records = [MetricRecord("hot term", search_volume=5000), MetricRecord("mid term", search_volume=300), MetricRecord("rare term", search_volume=20)]
    pool.add_metrics(db, rows, records, provider="p", source="google_ads", market="US", language="en", ttl_days=21)
    db.commit()
    for term, expected in (("hot term", 14), ("mid term", 21), ("rare term", 45), ("no data term", 45)):
        assert abs(_days(db, term) - expected) <= expected * 0.16, term  # ±%15 sapma


def test_tier_thresholds_and_days_come_from_settings(db):
    assert policy.tiered_ttl_days(1000, 21) == 14 and policy.tiered_ttl_days(999, 21) == 21 and policy.tiered_ttl_days(99, 21) == 45
    app_settings.set_many(db, {"research_tier_high_volume": 500, "research_ttl_volume_high_days": 7})
    assert policy.tiered_ttl_days(600, 21) == 7


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

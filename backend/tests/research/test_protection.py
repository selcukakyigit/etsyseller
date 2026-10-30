"""Koruma: iş türü başına bütçe tavanı, sağlayıcı devre kesici, hatalı çağrının maliyeti, yönetim uyarıları."""
import datetime as dt

import pytest
from sqlalchemy import select

from app.core import app_settings
from app.research import alerts, service, worker
from app.research.models import ProviderCall, ResearchJob
from app.research.records import ProviderError


@pytest.fixture(autouse=True)
def _fresh_alert_cache():
    alerts.clear_cache()
    yield
    alerts.clear_cache()


def _call(db, *, ok=True, cost=0.0, kind="volume", minutes_ago=0):
    db.add(ProviderCall(provider="dataforseo", endpoint="e", market="US", language="en", cost_usd=cost, ok=ok, kind=kind, created_at=dt.datetime.utcnow() - dt.timedelta(minutes=minutes_ago)))
    db.commit()


def test_a_kind_over_its_cap_is_refused_but_other_kinds_still_work(db, provider):
    _call(db, cost=5.0, kind="season")  # mevsimsellik tavanı (5 $) doldu; sistem tavanı (30 $) dolmadı
    assert service.seasonality(db, "metal sign").refused == "budget"
    assert service.volumes(db, ["metal sign"]).pending == 1


def test_zero_cap_means_no_separate_limit_for_that_kind(db, provider):
    app_settings.set_many(db, {"research_budget_season_usd": 0.0})
    _call(db, cost=5.0, kind="season")
    assert service.seasonality(db, "metal sign").refused is None


def test_worker_defers_queued_jobs_of_a_capped_kind_without_calling_the_provider(db, provider):
    assert service.seasonality(db, "metal sign").pending
    service.volumes(db, ["other thing"])
    _call(db, cost=5.0, kind="season")  # iş kuyruktayken tavan doldu
    worker.run_once(db)
    assert provider.count("season") == 0 and provider.count("volume") == 1
    season = db.scalar(select(ResearchJob).where(ResearchJob.kind == "season"))
    assert season.status == "queued" and season.attempts == 0 and season.run_after > dt.datetime.utcnow()


def test_breaker_pauses_the_worker_after_consecutive_failures_and_jobs_keep_their_attempts(db, provider):
    for _ in range(worker.BREAKER_FAILS):
        _call(db, ok=False)
    assert worker.breaker_until(db) is not None
    service.volumes(db, ["metal sign"])
    assert worker.run_once(db) == 0 and provider.calls == []
    job = db.scalar(select(ResearchJob))
    assert job.status == "queued" and job.attempts == 0


def test_breaker_stays_closed_with_one_success_and_allows_a_probe_after_the_pause(db, provider):
    for _ in range(worker.BREAKER_FAILS - 1):
        _call(db, ok=False)
    _call(db, ok=True)
    assert worker.breaker_until(db) is None

    db.query(ProviderCall).delete()
    for _ in range(worker.BREAKER_FAILS):
        _call(db, ok=False, minutes_ago=30)  # duraklama süresi geçti
    assert worker.breaker_until(db) is None
    service.volumes(db, ["metal sign"])
    assert worker.run_once(db) == 1 and provider.count("volume") == 1


def test_failed_call_keeps_the_cost_the_provider_charged(db, provider):
    provider.fail = ProviderError("Sağlayıcı hatası 50000: x", cost_usd=0.02)
    service.volumes(db, ["metal sign"])
    worker.run_once(db)
    call = db.scalar(select(ProviderCall))
    assert (call.ok, float(call.cost_usd), call.kind) == (False, 0.02, "volume")


def _keys(db):
    return {a.key: a for a in alerts.compute(db)}


def test_alerts_budget_levels_and_kind_cap(db, provider, monkeypatch):
    monkeypatch.setattr(alerts, "_balance", lambda db: 100.0)
    assert _keys(db) == {}
    _call(db, cost=25.0, kind="volume")  # 30 $ tavanın %83'ü
    assert _keys(db)["budget_warn"].level == "warn"
    _call(db, cost=6.0, kind="season")
    found = _keys(db)
    assert found["budget_full"].level == "bad" and "budget_warn" not in found and "kind_budget:season" in found


def test_alerts_error_rate_needs_enough_calls_and_breaker_silences_queue_stuck(db, provider, monkeypatch):
    monkeypatch.setattr(alerts, "_balance", lambda db: 100.0)
    for _ in range(4):
        _call(db, ok=False)
    assert "error_rate" not in _keys(db)  # az çağrıda oran anlamsız
    for _ in range(6):
        _call(db, ok=False)
    found = _keys(db)
    assert found["error_rate"].level == "bad" and "breaker" in found

    db.add(ResearchJob(kind="volume", provider="dataforseo", market="US", language="en", idem_key="k", run_after=dt.datetime.utcnow() - dt.timedelta(hours=1)))
    db.commit()
    assert "queue_stuck" not in _keys(db)  # devre kesici açık: bekleme beklenen durum

    db.query(ProviderCall).delete()
    db.commit()
    assert _keys(db)["queue_stuck"].value >= 60


def test_alerts_low_balance_uses_the_cached_provider_account(db, provider):
    found = _keys(db)  # sahte sağlayıcının bakiyesi 1 $ < eşik 5 $
    assert found["low_balance"].level == "warn" and found["low_balance"].value == 1.0
    provider.account = lambda creds: (_ for _ in ()).throw(ProviderError("down"))
    assert "low_balance" in _keys(db)  # önbellekten; sağlayıcı çökse de panel çökmez
    alerts.clear_cache()
    assert "low_balance" not in _keys(db)  # bakiye okunamadı: uyarı uydurulmaz

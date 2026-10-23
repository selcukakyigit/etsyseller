"""Bakım: saklama temizliği, tek kuyruk yürütücü kilidi, admin ayar doğrulaması."""
import datetime as dt

import pytest

from app.jobs import research as research_jobs
from app.research import admin, pool, retention
from app.research.models import KeywordMetric, ProviderCall, ResearchJob


def _job(db, status, finished_days_ago):
    db.add(ResearchJob(kind="volume", provider="dataforseo", market="US", language="en", idem_key=f"k{db.query(ResearchJob).count()}", status=status,
                       finished_at=dt.datetime.utcnow() - dt.timedelta(days=finished_days_ago)))


def test_retention_purges_old_finished_jobs_calls_and_metrics_only(db):
    _job(db, "done", 40)
    _job(db, "done", 5)
    _job(db, "queued", 90)  # bekleyen iş hiç silinmez
    db.add(ProviderCall(provider="dataforseo", endpoint="e", market="US", language="en", created_at=dt.datetime.utcnow() - dt.timedelta(days=200)))
    db.add(ProviderCall(provider="dataforseo", endpoint="e", market="US", language="en"))
    kw = pool.get_or_create_terms(db, ["a term"], "en", "t")["a term"]
    old = dt.datetime.utcnow() - dt.timedelta(days=800)
    now = dt.datetime.utcnow()
    db.add_all([
        KeywordMetric(keyword_id=kw.id, provider="p", source="s", market="US", language="en", measured_at=old, expires_at=old),
        KeywordMetric(keyword_id=kw.id, provider="p", source="s", market="US", language="en", measured_at=now, expires_at=now),
    ])
    db.commit()
    assert retention.purge(db) == 3
    assert db.query(ResearchJob).count() == 2 and db.query(ProviderCall).count() == 1 and db.query(KeywordMetric).count() == 1


def test_only_one_queue_runner_at_a_time(db, provider, monkeypatch):
    ran = []
    monkeypatch.setattr(research_jobs.worker, "run_once", lambda session: ran.append(1))
    assert research_jobs._queue_lock.acquire(blocking=False)
    try:
        research_jobs.run_queue()  # meşgul: sessizce çıkar
        assert ran == []
    finally:
        research_jobs._queue_lock.release()
    research_jobs.run_queue()
    assert ran == [1]


def test_admin_settings_are_validated(db):
    assert admin.settings_validate({"research_enabled": 0, "research_monthly_budget_usd": "12.5", "research_default_market": " us "}) == {
        "research_enabled": False, "research_monthly_budget_usd": 12.5, "research_default_market": "US",
    }
    with pytest.raises(ValueError):
        admin.settings_validate({"unknown_setting": 1})
    with pytest.raises(ValueError):
        admin.settings_validate({"research_monthly_budget_usd": -1})

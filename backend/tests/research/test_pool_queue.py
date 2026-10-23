"""Ortak havuz ve iş kuyruğu: istek içinde sağlayıcı çağrılmaz, aynı sorgu tek iş, toplu istek, TTL, hata/yeniden deneme, bütçe."""
import datetime as dt

from app.core import app_settings
from app.research import jobs, service, worker
from app.research.models import ProviderCall, ResearchJob
from app.research.records import ProviderError


def test_request_only_queues_and_never_calls_the_provider(db, provider):
    result = service.volumes(db, ["Metal Sign", "metal  sign ", "farm sign", "nodata"])
    assert result.pending == 3 and not result.metrics  # "Metal Sign" ve "metal  sign " aynı kelime
    assert provider.calls == []


def test_same_query_is_single_flight(db, provider):
    service.volumes(db, ["farm sign", "metal sign"])
    service.volumes(db, ["metal sign", "farm sign"])
    assert db.query(ResearchJob).count() == 1


def test_worker_merges_pending_volume_jobs_into_one_request(db, provider):
    service.volumes(db, ["a one", "a two"])
    service.volumes(db, ["b one"])
    assert db.query(ResearchJob).count() == 2
    assert worker.run_once(db) == 1  # tek sağlayıcı isteği
    assert provider.count("volume") == 1 and sorted(provider.calls[0][1]) == ["a one", "a two", "b one"]
    assert {j.status for j in db.query(ResearchJob)} == {"done"}
    assert db.query(ProviderCall).one().cost_usd == 0.09  # maliyet bir kez kaydedilir


def test_fresh_data_is_served_from_the_pool_until_ttl(db, provider):
    service.volumes(db, ["metal sign"])
    worker.run_once(db)
    again = service.volumes(db, ["metal sign"])
    assert again.pending == 0 and again.metrics["metal sign"].fresh and again.metrics["metal sign"].search_volume == 100
    worker.run_once(db)
    assert provider.count("volume") == 1  # ikinci istek sağlayıcıya gitmedi


def test_term_with_no_provider_data_is_not_asked_again(db, provider):
    provider.no_data = {"nodata"}
    service.volumes(db, ["nodata"])
    worker.run_once(db)
    result = service.volumes(db, ["nodata"])
    assert result.metrics["nodata"].search_volume is None and result.pending == 0
    assert db.query(ResearchJob).count() == 1


def test_transient_error_is_retried_with_backoff_then_dies(db, provider):
    provider.fail = ProviderError("boom", transient=True)
    service.volumes(db, ["new term"])
    worker.run_once(db)
    job = db.query(ResearchJob).one()
    assert (job.status, job.attempts) == ("queued", 1) and "boom" in job.error and job.run_after > dt.datetime.utcnow()
    for _ in range(2):  # kalan denemeler
        job.run_after = dt.datetime.utcnow()
        db.commit()
        worker.run_once(db)
        db.refresh(job)
    assert (job.status, job.attempts) == ("dead", 3)


def test_permanent_error_is_not_retried_and_can_be_retried_by_admin(db, provider):
    provider.fail = ProviderError("bad credentials", transient=False)
    service.volumes(db, ["term"])
    worker.run_once(db)
    job = db.query(ResearchJob).one()
    assert job.status == "failed"
    provider.fail = None
    assert jobs.retry(db, job) and job.status == "queued"
    db.commit()
    worker.run_once(db)
    db.refresh(job)
    assert job.status == "done"


def test_cancel_only_applies_to_queued_jobs(db, provider):
    service.volumes(db, ["term"])
    job = db.query(ResearchJob).one()
    assert jobs.cancel(job) and job.status == "cancelled"
    assert not jobs.cancel(job)


def test_monthly_budget_stops_new_requests_but_keeps_old_data(db, provider):
    service.volumes(db, ["old term"])
    worker.run_once(db)
    app_settings.set_many(db, {"research_monthly_budget_usd": 0.0})
    result = service.volumes(db, ["old term", "brand new"])
    assert result.refused == "budget" and result.pending == 0
    assert result.metrics["old term"].search_volume == 100  # eski veri sunulmaya devam eder


def test_budget_defers_queued_jobs_without_spending_an_attempt(db, provider):
    service.volumes(db, ["term"])
    app_settings.set_many(db, {"research_monthly_budget_usd": 0.0})
    worker.run_once(db)
    job = db.query(ResearchJob).one()
    assert job.status == "queued" and job.attempts == 0 and provider.calls == []


def test_disabled_research_queues_nothing(db, provider):
    app_settings.set_many(db, {"research_enabled": False})
    result = service.volumes(db, ["term"])
    assert result.refused == "disabled" and db.query(ResearchJob).count() == 0


def test_stuck_running_job_is_recovered(db, provider):
    service.volumes(db, ["term"])
    job = db.query(ResearchJob).one()
    job.status, job.locked_at = "running", dt.datetime.utcnow() - dt.timedelta(minutes=30)
    db.commit()
    worker.run_once(db)
    db.refresh(job)
    assert job.status == "done"

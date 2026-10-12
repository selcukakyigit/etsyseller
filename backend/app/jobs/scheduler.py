import datetime as dt
import logging

from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED, JobExecutionEvent
from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.jobs.daily_stats import capture_daily_stats
from app.jobs.demand_trends import refresh_demand
from app.jobs.finance_sync import sync_all_shops as sync_finance
from app.jobs.listing_health import evaluate_all_shops
from app.jobs.listing_refresh import refresh_all_shops
from app.jobs.order_sync import sync_all_shops
from app.jobs.rank_tracking import track_all_shops
from app.jobs.retention import purge_expired_records
from app.jobs.reviews import sync_all_shops as sync_reviews
from app.jobs.shop_profile import sync_all_shops as sync_shop_profile

logger = logging.getLogger(__name__)

# En fazla 2 iş aynı anda çalışsın: hepsi aynı anda başlarsa bellek 512 MB sınırını aşıp servisi yeniden başlatabiliyor.
_scheduler = BackgroundScheduler(timezone="UTC", executors={"default": ThreadPoolExecutor(2)})

INITIAL_RUN_SUFFIX = "_initial_run"
MANUAL_RUN_SUFFIX = "_manual_run"
_ONE_OFF_SUFFIXES = (INITIAL_RUN_SUFFIX, MANUAL_RUN_SUFFIX)
# İş kimliği -> son çalışmanın sonucu (yönetim panelindeki Sistem sayfası için). Bellek içidir; işler ayrı bir worker'a
# taşınınca ortak bir depoya yazılmalı (bkz. admin/system.py).
_last_runs: dict[str, dict] = {}


def _base_id(job_id: str) -> str:
    for suffix in _ONE_OFF_SUFFIXES:
        job_id = job_id.removesuffix(suffix)
    return job_id


def _record_run(event: JobExecutionEvent) -> None:
    job_id = _base_id(event.job_id)
    error = None if event.exception is None else f"{type(event.exception).__name__}: {event.exception}"[:300]
    _last_runs[job_id] = {"last_run": dt.datetime.now(dt.timezone.utc), "last_ok": error is None, "last_error": error}


def is_running() -> bool:
    return _scheduler.running


def job_status() -> list[dict]:
    """Her zamanlanmış işin bir sonraki ve son çalışması. Tek seferlik çalışmalar (açılışta ya da panelden elle) asıl işin
    kaydına yazılır."""
    next_runs = {j.id: j.next_run_time for j in _scheduler.get_jobs() if _base_id(j.id) == j.id} if _scheduler.running else {}
    last_runs = _last_runs.copy()  # iş iş parçacıkları aynı anda yazabilir; kopya üzerinden okunur
    empty = {"last_run": None, "last_ok": None, "last_error": None}
    return [{"id": job_id, "next_run": next_runs.get(job_id), **last_runs.get(job_id, empty)} for job_id in sorted(set(next_runs) | set(last_runs))]


def start_scheduler() -> None:
    _scheduler.add_listener(_record_run, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)
    _scheduler.add_job(
        capture_daily_stats,
        trigger=CronTrigger(hour=3, minute=0),
        id="daily_stats",
        replace_existing=True,
    )
    _scheduler.add_job(
        sync_all_shops,
        trigger=IntervalTrigger(hours=2),
        id="order_sync",
        replace_existing=True,
    )
    _scheduler.add_job(
        refresh_all_shops,
        trigger=IntervalTrigger(hours=4),
        id="listing_refresh",
        replace_existing=True,
    )
    _scheduler.add_job(
        sync_finance,
        trigger=IntervalTrigger(hours=4),
        id="finance_sync",
        replace_existing=True,
    )
    _scheduler.add_job(
        evaluate_all_shops,
        trigger=CronTrigger(hour=3, minute=15),
        id="listing_health",
        replace_existing=True,
    )
    _scheduler.add_job(
        sync_shop_profile,
        trigger=IntervalTrigger(hours=4),
        id="shop_profile",
        replace_existing=True,
    )
    _scheduler.add_job(
        purge_expired_records,
        trigger=CronTrigger(hour=4, minute=0),
        id="retention_purge",
        replace_existing=True,
    )
    _scheduler.add_job(
        sync_reviews,
        trigger=IntervalTrigger(hours=4),
        id="reviews",
        replace_existing=True,
    )
    _scheduler.add_job(
        track_all_shops,
        trigger=CronTrigger(hour=5, minute=30),
        id="rank_tracking",
        replace_existing=True,
    )
    _scheduler.add_job(
        refresh_demand,
        trigger=CronTrigger(day_of_week="mon", hour=6, minute=30),
        id="demand_trends",
        replace_existing=True,
    )
    _scheduler.start()

    # Yeni süreç başlayınca her işi bir kez de çalıştır ki arayüz ilk günden veri görsün. Hepsi aynı anda değil, 45 sn
    # arayla: yeniden başlatma döngüsünde (ör. bellek yetersizliği) hepsinin birden başlayıp durumu kötüleştirmesini önler.
    now = dt.datetime.now(dt.timezone.utc)
    for i, (func, job_id) in enumerate(
        [
            (sync_all_shops, "order_sync_initial_run"),
            (sync_shop_profile, "shop_profile_initial_run"),
            (capture_daily_stats, "daily_stats_initial_run"),
            (sync_reviews, "reviews_initial_run"),
            (evaluate_all_shops, "listing_health_initial_run"),
            (refresh_all_shops, "listing_refresh_initial_run"),
            (sync_finance, "finance_sync_initial_run"),
            (track_all_shops, "rank_tracking_initial_run"),
        ],
        start=1,
    ):
        _scheduler.add_job(func, trigger=DateTrigger(run_date=now + dt.timedelta(seconds=45 * i)), id=job_id, replace_existing=True)

    logger.info(
        "Scheduler started: daily_stats 03:00, listing_health 03:15 UTC; order_sync every 2h, "
        "listing_refresh/shop_profile/reviews every 4h, finance_sync every 4h (all also run once shortly after start)."
    )


def run_now(job_id: str) -> bool:
    """Zamanlanmış bir işi hemen bir kez çalıştırır (yönetim paneli). İş yoksa ya da zaten elle başlatılmış ve henüz
    başlamamışsa False. Aynı anda en fazla 2 iş çalıştığı için sırada bekleyebilir."""
    if not _scheduler.running or _base_id(job_id) != job_id:
        return False
    job = _scheduler.get_job(job_id)
    if job is None or _scheduler.get_job(job_id + MANUAL_RUN_SUFFIX) is not None:
        return False
    _scheduler.add_job(job.func, trigger=DateTrigger(run_date=dt.datetime.now(dt.timezone.utc)), id=job_id + MANUAL_RUN_SUFFIX)
    return True


def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)

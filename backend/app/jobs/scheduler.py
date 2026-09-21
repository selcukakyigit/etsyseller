import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.jobs.daily_stats import capture_daily_stats
from app.jobs.order_sync import sync_all_shops

logger = logging.getLogger(__name__)

_scheduler = BackgroundScheduler(timezone="UTC")


def start_scheduler() -> None:
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
    _scheduler.start()

    # Run both once immediately in the background so the UI has data from
    # day one instead of waiting for the first scheduled firing.
    _scheduler.add_job(capture_daily_stats, id="daily_stats_initial_run", replace_existing=True)
    _scheduler.add_job(sync_all_shops, id="order_sync_initial_run", replace_existing=True)

    logger.info("Scheduler started: daily_stats at 03:00 UTC, order_sync every 2h (both also run once now).")


def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)

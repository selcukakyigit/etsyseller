import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.jobs.daily_stats import capture_daily_stats
from app.jobs.listing_health import evaluate_all_shops
from app.jobs.order_sync import sync_all_shops
from app.jobs.reviews import sync_all_shops as sync_reviews
from app.jobs.shop_profile import sync_all_shops as sync_shop_profile

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
    _scheduler.add_job(
        evaluate_all_shops,
        trigger=CronTrigger(hour=3, minute=15),
        id="listing_health",
        replace_existing=True,
    )
    _scheduler.add_job(
        sync_shop_profile,
        trigger=CronTrigger(hour=3, minute=30),
        id="shop_profile",
        replace_existing=True,
    )
    _scheduler.add_job(
        sync_reviews,
        trigger=CronTrigger(hour=3, minute=45),
        id="reviews",
        replace_existing=True,
    )
    _scheduler.start()

    # Run all five once immediately in the background so the UI has data from
    # day one instead of waiting for the first scheduled firing.
    _scheduler.add_job(capture_daily_stats, id="daily_stats_initial_run", replace_existing=True)
    _scheduler.add_job(sync_all_shops, id="order_sync_initial_run", replace_existing=True)
    _scheduler.add_job(evaluate_all_shops, id="listing_health_initial_run", replace_existing=True)
    _scheduler.add_job(sync_shop_profile, id="shop_profile_initial_run", replace_existing=True)
    _scheduler.add_job(sync_reviews, id="reviews_initial_run", replace_existing=True)

    logger.info(
        "Scheduler started: daily_stats 03:00, listing_health 03:15, shop_profile 03:30, reviews 03:45 UTC; "
        "order_sync every 2h (all also run once now)."
    )


def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)

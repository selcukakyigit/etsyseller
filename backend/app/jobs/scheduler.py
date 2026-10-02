import datetime as dt
import logging

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.jobs.daily_stats import capture_daily_stats
from app.jobs.finance_sync import sync_all_shops as sync_finance
from app.jobs.listing_health import evaluate_all_shops
from app.jobs.listing_refresh import refresh_all_shops
from app.jobs.order_sync import sync_all_shops
from app.jobs.retention import purge_expired_records
from app.jobs.reviews import sync_all_shops as sync_reviews
from app.jobs.shop_profile import sync_all_shops as sync_shop_profile

logger = logging.getLogger(__name__)

# En fazla 2 iş aynı anda çalışsın: hepsi aynı anda başlarsa bellek 512 MB sınırını aşıp servisi yeniden başlatabiliyor.
_scheduler = BackgroundScheduler(timezone="UTC", executors={"default": ThreadPoolExecutor(2)})


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
        ],
        start=1,
    ):
        _scheduler.add_job(func, trigger=DateTrigger(run_date=now + dt.timedelta(seconds=45 * i)), id=job_id, replace_existing=True)

    logger.info(
        "Scheduler started: daily_stats 03:00, listing_health 03:15 UTC; order_sync every 2h, "
        "listing_refresh/shop_profile/reviews every 4h, finance_sync every 4h (all also run once shortly after start)."
    )


def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)

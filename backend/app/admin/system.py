"""Sistem sağlığı: Etsy günlük çağrı sayısı, zamanlanmış işlerin durumu ve mağaza senkronlarının tazeliği.

Etsy sayacı ve iş durumları şu an bu sürecin belleğindedir (etsy/rate_limit.py, jobs/scheduler.py). İşler ayrı bir worker'a
taşındığında yalnızca `etsy_usage` ve `jobs` ortak bir depodan (ör. Redis) okunacak şekilde değişir; panelin geri kalanı
bu fonksiyonların döndürdüğü biçime bağlıdır."""
import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dates import iso
from app.admin.schemas import JobOut, ShopSyncOut, SystemOut
from app.auth.models import User
from app.etsy import rate_limit
from app.jobs import scheduler
from app.shops.models import Shop

# Etsy kuralı: ilan verisi en fazla 6 saat eski gösterilebilir (bkz. Shop.listings_synced_at).
STALE_AFTER = dt.timedelta(hours=6)
MAX_SHOPS = 200


def etsy_usage() -> dict[str, int]:
    return {
        "calls_today": rate_limit.calls_today(),
        "daily_limit": rate_limit.DAILY_LIMIT,
        "background_budget": rate_limit.DAILY_BUDGET_FOR_BACKGROUND,
    }


def jobs() -> list[JobOut]:
    return [
        JobOut(id=j["id"], next_run=iso(j["next_run"]), last_run=iso(j["last_run"]), last_ok=j["last_ok"], last_error=j["last_error"])
        for j in scheduler.job_status()
    ]


def shop_sync(db: Session) -> list[ShopSyncOut]:
    """Gerçek mağazalar, en eski senkron en üstte (hiç senkron olmamışlar en başta)."""
    now = dt.datetime.utcnow()
    rows = db.execute(
        select(Shop.id, Shop.shop_name, User.email, Shop.listings_synced_at, Shop.access_revoked_at)
        .join(User, User.id == Shop.user_id)
        .where(Shop.is_demo.is_(False))
        .order_by(Shop.listings_synced_at.is_not(None), Shop.listings_synced_at)
        .limit(MAX_SHOPS)
    ).all()
    return [
        ShopSyncOut(
            id=shop_id,
            shop_name=name,
            owner_email=email,
            listings_synced_at=iso(synced),
            revoked=revoked is not None,
            stale=revoked is None and (synced is None or now - synced > STALE_AFTER),
        )
        for shop_id, name, email, synced, revoked in rows
    ]


def get_system(db: Session) -> SystemOut:
    etsy = etsy_usage()
    return SystemOut(
        etsy_calls_today=etsy["calls_today"],
        etsy_daily_limit=etsy["daily_limit"],
        etsy_background_budget=etsy["background_budget"],
        scheduler_running=scheduler.is_running(),
        jobs=jobs(),
        shops=shop_sync(db),
    )

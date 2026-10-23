"""Maliyet tavanları. Tavan aşılınca sistem DURMAZ: yeni sağlayıcı çağrısı yapılmaz, havuzdaki eski veri "güncel değil" etiketiyle sunulmaya devam eder."""
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.research import policy
from app.research.models import ProviderCall, ResearchJob


class QueueRefused(Exception):
    """İş kuyruğa alınmadı (kota ya da bütçe). `reason`: budget | shop_daily | disabled | not_configured | market."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def month_start(now: dt.datetime | None = None) -> dt.datetime:
    now = now or dt.datetime.utcnow()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_spend(db: Session) -> float:
    return float(db.scalar(select(func.coalesce(func.sum(ProviderCall.cost_usd), 0)).where(ProviderCall.created_at >= month_start())) or 0)


def over_budget(db: Session) -> bool:
    return month_spend(db) >= float(policy.get("research_monthly_budget_usd"))


def shop_jobs_today(db: Session, shop_id: int) -> int:
    since = dt.datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return int(db.scalar(select(func.count(ResearchJob.id)).where(ResearchJob.shop_id == shop_id, ResearchJob.created_at >= since)) or 0)


def check_enqueue(db: Session, shop_id: int | None) -> None:
    if not policy.get("research_enabled"):
        raise QueueRefused("disabled")
    if over_budget(db):
        raise QueueRefused("budget")
    if shop_id is not None and shop_jobs_today(db, shop_id) >= int(policy.get("research_shop_daily_jobs")):
        raise QueueRefused("shop_daily")

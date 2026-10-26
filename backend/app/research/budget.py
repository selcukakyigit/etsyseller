"""Maliyet tavanları. Tavan aşılınca sistem DURMAZ: yeni sağlayıcı çağrısı yapılmaz, havuzdaki eski veri "güncel değil" etiketiyle sunulmaya devam eder."""
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.research import policy
from app.research.models import ProviderCall, ResearchJob


class QueueRefused(Exception):
    """İş kuyruğa alınmadı (kota ya da bütçe). `reason`: budget | shop_daily | shop_searches (günlük üst sınır) | shop_month (aylık hak) | disabled | not_configured | market."""

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


def _shop_jobs_since(db: Session, shop_id: int, since: dt.datetime, kind: str | None = None) -> int:
    q = select(func.count(ResearchJob.id)).where(ResearchJob.shop_id == shop_id, ResearchJob.created_at >= since)
    if kind:
        q = q.where(ResearchJob.kind == kind)
    return int(db.scalar(q) or 0)


def shop_jobs_today(db: Session, shop_id: int, kind: str | None = None) -> int:
    return _shop_jobs_since(db, shop_id, dt.datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0), kind)


def shop_jobs_this_month(db: Session, shop_id: int, kind: str | None = None) -> int:
    return _shop_jobs_since(db, shop_id, month_start(), kind)


def search_allowance(db: Session, shop_id: int) -> dict:
    """Mağazanın YENİ kelime araştırması hakkı (Keşfet ekranı ve asistan aynı sayıyı gösterir): aylık hak ve onun tek günde bitmesini önleyen günlük üst sınır.
    `remaining`: şu an yapılabilecek yeni araştırma sayısı (ikisinin küçüğü). Havuzda hazır kelimeler sınırsızdır, sayılmaz."""
    month_limit = int(policy.get("research_shop_monthly_searches"))
    day_limit = int(policy.get("research_shop_daily_searches"))
    month_used = shop_jobs_this_month(db, shop_id, "suggest")
    day_used = shop_jobs_today(db, shop_id, "suggest")
    return {
        "month_limit": month_limit, "month_used": month_used, "day_limit": day_limit, "day_used": day_used,
        "remaining": max(0, min(month_limit - month_used, day_limit - day_used)),
    }


def check_enqueue(db: Session, shop_id: int | None, kind: str | None = None) -> None:
    if not policy.get("research_enabled"):
        raise QueueRefused("disabled")
    if over_budget(db):
        raise QueueRefused("budget")
    if shop_id is not None and shop_jobs_today(db, shop_id) >= int(policy.get("research_shop_daily_jobs")):
        raise QueueRefused("shop_daily")
    if shop_id is not None and kind == "suggest":
        if shop_jobs_this_month(db, shop_id, "suggest") >= int(policy.get("research_shop_monthly_searches")):
            raise QueueRefused("shop_month")
        if shop_jobs_today(db, shop_id, "suggest") >= int(policy.get("research_shop_daily_searches")):
            raise QueueRefused("shop_searches")

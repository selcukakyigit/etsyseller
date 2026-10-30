"""Genel bakış trendleri: günlük kayıt, AI kullanan çalışma alanı, AI isteği, harcanan kredi, sağlayıcı maliyeti ve gelir. Yalnızca okur;
eksik günler sıfırla doldurulur ki grafik düz bir zaman ekseni olsun."""
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.admin import revenue
from app.admin.schemas import TrendPointOut, TrendsOut
from app.auth.models import User
from app.billing.models import CreditLedger

MAX_DAYS = 180


def trends(db: Session, days: int = 30) -> TrendsOut:
    days = max(7, min(days, MAX_DAYS))
    today = dt.datetime.utcnow().date()
    first = today - dt.timedelta(days=days - 1)
    since = dt.datetime.combine(first, dt.time.min)

    signups = {str(d): int(n) for d, n in db.execute(
        select(func.date(User.created_at), func.count(User.id)).where(User.created_at >= since).group_by(func.date(User.created_at))
    ).all()}
    day = func.date(CreditLedger.created_at)
    usage = {
        str(d): (int(workspaces), int(n), int(credits), float(cost))
        for d, workspaces, n, credits, cost in db.execute(
            select(day, func.count(func.distinct(CreditLedger.workspace_id)), func.count(CreditLedger.id),
                   func.coalesce(func.sum(CreditLedger.credits), 0), func.coalesce(func.sum(CreditLedger.cost_usd), 0))
            .where(CreditLedger.kind == "usage", CreditLedger.created_at >= since).group_by(day)
        ).all()
    }
    currency, money = revenue.revenue_by_day(db, since)

    points = []
    for i in range(days):
        d = (first + dt.timedelta(days=i)).isoformat()
        workspaces, n, credits, cost = usage.get(d, (0, 0, 0, 0.0))
        points.append(TrendPointOut(date=d, signups=signups.get(d, 0), active_workspaces=workspaces, ai_requests=n, credits_spent=credits,
                                    ai_cost_usd=round(cost, 4), revenue=money.get(d, 0.0)))
    return TrendsOut(days=days, revenue_currency=currency, points=points)

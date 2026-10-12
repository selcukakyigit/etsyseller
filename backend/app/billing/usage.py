"""Kredi kullanım dökümü: harcanan krediyi kategoriye (metin / görsel / video / sistem), modele ve güne göre toplar. Kullanıcı kendi çalışma alanının,
yönetici istediği çalışma alanının ya da tümünün dökümünü görür; sağlayıcı maliyeti (USD) ve marj yalnızca yöneticiye döner.

Kategori görevden gelir (`CATEGORY`); "sistem" harcamanın sabit platform payıdır (`credit_ledger.platform_credits`), kalanı sağlayıcı payıdır ve
görevin kategorisine yazılır. Yeni bir AI görevi eklenince buraya da yazılır."""
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.billing import settings as credit_settings
from app.billing.models import CreditLedger

CATEGORY = {"assistant": "text", "seo": "text", "vision": "text", "document": "text", "image": "image", "video": "video"}
CATEGORIES = ("text", "image", "video", "system")
MAX_DAYS = 366


def category(task: str | None) -> str:
    return CATEGORY.get(task or "", "text")


def breakdown(db: Session, workspace_id: int | None, days: int = 30, *, include_cost: bool = False) -> dict:
    """`workspace_id` None: bütün çalışma alanları (yönetici). `include_cost`: sağlayıcı maliyeti, gelir ve marj da döner (yalnızca yönetici)."""
    days = max(1, min(days, MAX_DAYS))
    since = dt.datetime.utcnow() - dt.timedelta(days=days)
    day = func.date(CreditLedger.created_at)
    stmt = (
        select(day, CreditLedger.task, CreditLedger.model, func.count(CreditLedger.id), func.coalesce(func.sum(CreditLedger.credits), 0),
               func.coalesce(func.sum(CreditLedger.platform_credits), 0), func.coalesce(func.sum(CreditLedger.cost_usd), 0))
        .where(CreditLedger.kind == "usage", CreditLedger.created_at >= since)
        .group_by(day, CreditLedger.task, CreditLedger.model)
    )
    if workspace_id is not None:
        stmt = stmt.where(CreditLedger.workspace_id == workspace_id)

    totals = dict.fromkeys(CATEGORIES, 0)
    by_day: dict[str, dict[str, int]] = {}
    by_model: dict[tuple[str, str], dict] = {}
    calls = cost_usd = 0
    for d, task, model, n, credits, platform, cost in db.execute(stmt).all():
        cat, provider = category(task), int(credits) - int(platform)
        totals[cat] += provider
        totals["system"] += int(platform)
        row = by_day.setdefault(str(d), dict.fromkeys(CATEGORIES, 0))
        row[cat] += provider
        row["system"] += int(platform)
        m = by_model.setdefault((cat, model or "?"), {"category": cat, "model": model or "?", "credits": 0, "calls": 0, "cost_usd": 0.0})
        m["credits"] += provider
        m["calls"] += int(n)
        m["cost_usd"] += float(cost)
        calls += int(n)
        cost_usd += float(cost)

    out = {
        "days": days, "calls": calls, "total": sum(totals.values()), "by_category": totals,
        "daily": [{"date": d, **by_day[d]} for d in sorted(by_day)],
        "by_model": sorted(({**m, "cost_usd": round(m["cost_usd"], 4)} for m in by_model.values()), key=lambda m: -m["credits"]),
    }
    if not include_cost:
        for m in out["by_model"]:
            del m["cost_usd"]
        return out
    revenue = out["total"] * credit_settings.setting("credit_usd")
    out.update({"cost_usd": round(cost_usd, 4), "revenue_usd": round(revenue, 4), "margin_usd": round(revenue - cost_usd, 4)})
    return out

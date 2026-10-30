"""Yönetim > Satış: gelir, iade ve sipariş listesi. Kaynak Lemon webhook kayıtlarıdır (`billing_events`): tutar ve para birimi orada saklanır,
kredi defterinde para yoktur. Yalnızca okur. Test modu siparişleri gelire katılmaz (yalnızca sayılır).

Tutarlar Lemon'da kuruş cinsindendir; burada ana birime (÷100) çevrilir. Para birimleri toplanmaz: her biri ayrı satırdır, günlük seri ve ürün
dökümü en çok satış yapılan ("ana") para biriminde verilir."""
import datetime as dt
import json
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.admin.schemas import (
    CostRevenueOut, CurrencyTotalsOut, DailyRevenueOut, OrderRowOut, OrdersPageOut, ProductRevenueOut, RevenueOut,
)
from app.auth.models import User, WorkspaceMember
from app.billing.models import BillingEvent, BillingProduct, CreditLedger
from app.core.dates import iso

MAX_DAYS = 366
MAX_EVENTS = 20000
MAX_PAGE = 100


def _money(cents) -> float:
    try:
        return round(int(cents) / 100, 2)
    except (TypeError, ValueError):
        return 0.0


def _parse(event: BillingEvent, products: dict[str, str]) -> dict | None:
    """Webhook kaydını sade bir satıra çevirir; gelir/iade olmayanları ve ödenmemiş siparişleri atar."""
    try:
        payload = json.loads(event.payload)
    except (TypeError, ValueError):
        return None
    attrs = payload.get("attributes") or {}
    kind = "order" if event.event_name == "order_created" else "refund" if event.event_name == "order_refunded" else None
    if kind is None or (kind == "order" and attrs.get("status") != "paid"):
        return None
    variant = str((attrs.get("first_order_item") or {}).get("variant_id") or "")
    cents = attrs.get("total") if kind == "order" else attrs.get("refunded_amount") or attrs.get("total")
    return {
        "kind": kind, "event_id": event.id, "date": event.created_at, "workspace_id": event.workspace_id,
        "product": products.get(variant) or (f"#{variant}" if variant else "?"), "amount": _money(cents),
        "currency": str(attrs.get("currency") or "USD").upper(), "test": bool(attrs.get("test_mode")),
    }


def _rows(db: Session, since: dt.datetime) -> tuple[list[dict], int]:
    """(gelir/iade satırları yeniden eskiye, test siparişi sayısı). Test siparişleri satırlara girmez."""
    products = {p.variant_id: p.name_en for p in db.scalars(select(BillingProduct)).all()}
    events = db.scalars(
        select(BillingEvent)
        .where(BillingEvent.ok.is_(True), BillingEvent.event_name.in_(("order_created", "order_refunded")), BillingEvent.created_at >= since)
        .order_by(BillingEvent.id.desc()).limit(MAX_EVENTS)
    ).all()
    rows, test = [], 0
    for e in events:
        row = _parse(e, products)
        if row is None:
            continue
        if row["test"]:
            test += row["kind"] == "order"
            continue
        rows.append(row)
    return rows, test


def _since(days: int) -> tuple[int, dt.datetime]:
    days = max(1, min(days, MAX_DAYS))
    return days, dt.datetime.utcnow() - dt.timedelta(days=days)


def _cost(db: Session, since: dt.datetime, revenue_usd: float | None) -> CostRevenueOut:
    ai = float(db.scalar(select(func.coalesce(func.sum(CreditLedger.cost_usd), 0)).where(CreditLedger.kind == "usage", CreditLedger.created_at >= since)) or 0)
    research = 0.0
    try:
        from app.research.models import ProviderCall

        research = float(db.scalar(select(func.coalesce(func.sum(ProviderCall.cost_usd), 0)).where(ProviderCall.created_at >= since)) or 0)
    except SQLAlchemyError:
        db.rollback()
    margin = None if revenue_usd is None else round(revenue_usd - ai - research, 2)
    return CostRevenueOut(ai_cost_usd=round(ai, 2), research_cost_usd=round(research, 2), revenue_usd=revenue_usd, margin_usd=margin)


def _main_currency(rows: list[dict]) -> str | None:
    gross: dict[str, float] = defaultdict(float)
    for r in rows:
        if r["kind"] == "order":
            gross[r["currency"]] += r["amount"]
    return max(gross, key=gross.get) if gross else None


def revenue(db: Session, days: int = 30) -> RevenueOut:
    days, since = _since(days)
    rows, test_orders = _rows(db, since)

    totals: dict[str, dict] = defaultdict(lambda: {"gross": 0.0, "refunds": 0.0, "orders": 0, "refunded_orders": 0})
    for r in rows:
        t = totals[r["currency"]]
        if r["kind"] == "order":
            t["gross"] += r["amount"]
            t["orders"] += 1
        else:
            t["refunds"] += r["amount"]
            t["refunded_orders"] += 1
    currencies = sorted(
        (CurrencyTotalsOut(currency=c, gross=round(t["gross"], 2), refunds=round(t["refunds"], 2), net=round(t["gross"] - t["refunds"], 2),
                           orders=t["orders"], refunded_orders=t["refunded_orders"]) for c, t in totals.items()),
        key=lambda c: -c.gross,
    )
    main = _main_currency(rows)

    by_day: dict[str, dict] = defaultdict(lambda: {"gross": 0.0, "refunds": 0.0})
    by_product: dict[str, dict] = defaultdict(lambda: {"orders": 0, "gross": 0.0})
    for r in rows:
        if r["currency"] != main:
            continue
        d = by_day[r["date"].date().isoformat()]
        if r["kind"] == "order":
            d["gross"] += r["amount"]
            p = by_product[r["product"]]
            p["orders"] += 1
            p["gross"] += r["amount"]
        else:
            d["refunds"] += r["amount"]

    usd = next((c for c in currencies if c.currency == "USD"), None)
    failed = int(db.scalar(select(func.count(BillingEvent.id)).where(BillingEvent.ok.is_(False), BillingEvent.created_at >= since)) or 0)
    return RevenueOut(
        days=days, main_currency=main, currencies=currencies,
        daily=[DailyRevenueOut(date=d, gross=round(v["gross"], 2), refunds=round(v["refunds"], 2)) for d, v in sorted(by_day.items())],
        by_product=sorted((ProductRevenueOut(name=n, orders=v["orders"], gross=round(v["gross"], 2)) for n, v in by_product.items()), key=lambda p: -p.gross),
        cost=_cost(db, since, usd.net if usd else None), test_orders=test_orders, failed_events=failed,
    )


def revenue_by_day(db: Session, since: dt.datetime) -> tuple[str | None, dict[str, float]]:
    """Günlük net gelir (ana para biriminde); genel bakış trendi kullanır."""
    rows, _ = _rows(db, since)
    main = _main_currency(rows)
    out: dict[str, float] = defaultdict(float)
    for r in rows:
        if r["currency"] == main:
            out[r["date"].date().isoformat()] += r["amount"] if r["kind"] == "order" else -r["amount"]
    return main, {d: round(v, 2) for d, v in out.items()}


def owner_emails(db: Session, workspace_ids: list[int]) -> dict[int, str]:
    if not workspace_ids:
        return {}
    rows = db.execute(
        select(WorkspaceMember.workspace_id, func.min(User.email))
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.role == "owner", WorkspaceMember.workspace_id.in_(workspace_ids))
        .group_by(WorkspaceMember.workspace_id)
    ).all()
    return dict(rows)


def order_rows(db: Session, days: int = 30) -> list[dict]:
    """Sipariş listesi ve dışa aktarma için aynı satırlar (yeniden eskiye), sahibin e-postasıyla."""
    _, since = _since(days)
    rows, _ = _rows(db, since)
    emails = owner_emails(db, sorted({r["workspace_id"] for r in rows if r["workspace_id"]}))
    for r in rows:
        r["owner_email"] = emails.get(r["workspace_id"])
    return rows


def orders(db: Session, days: int = 30, limit: int = 50, offset: int = 0) -> OrdersPageOut:
    rows = order_rows(db, days)
    start = max(0, offset)
    page = rows[start: start + max(1, min(limit, MAX_PAGE))]
    return OrdersPageOut(
        total=len(rows),
        items=[
            OrderRowOut(kind=r["kind"], date=iso(r["date"]), event_id=r["event_id"], workspace_id=r["workspace_id"], owner_email=r["owner_email"],
                        product=r["product"], amount=r["amount"], currency=r["currency"])
            for r in page
        ],
    )

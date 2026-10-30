"""Yönetim panelinden CSV dışa aktarma: kullanıcılar, kredi hareketleri, siparişler/iadeler, işlem kaydı. Yalnızca okur; ekrandaki filtrelerle aynı
süzgeçleri kullanır. Excel'in Türkçe karakterleri doğru açması için dosya BOM'lu UTF-8'dir."""
import csv
import datetime as dt
import io

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin import audit, revenue, users
from app.auth.models import User
from app.billing.models import CreditLedger
from app.core.dates import iso

MAX_ROWS = 50000
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value) -> str:
    """Tablo programı hücreyi formül sanmasın (CSV enjeksiyonu): tehlikeli başlangıçlı metnin başına `'` konur. Sayılar olduğu gibi yazılır."""
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    return "'" + text if text.startswith(_FORMULA_START) else text


def to_csv(header: list[str], rows) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    for row in rows:
        writer.writerow([safe_cell(v) for v in row])
    return "﻿" + out.getvalue()


def users_csv(db: Session, q: str, status: str, joined_from: dt.date | None, joined_to: dt.date | None) -> str:
    items, offset = [], 0
    while len(items) < MAX_ROWS:
        page = users.list_users(db, q=q, status=status, joined_from=joined_from, joined_to=joined_to, sort="newest", limit=users.MAX_PAGE, offset=offset)
        items.extend(page.items)
        offset += users.MAX_PAGE
        if offset >= page.total:
            break
    return to_csv(
        ["id", "email", "name", "status", "role", "credits", "ai_requests_30d", "shops", "last_seen_at", "created_at"],
        ([u.id, u.email, u.name, u.status, u.role, u.credits, u.ai_requests_30d, len(u.shops), u.last_seen_at, u.created_at] for u in items),
    )


def ledger_csv(db: Session, days: int, workspace_id: int | None) -> str:
    since = dt.datetime.utcnow() - dt.timedelta(days=max(1, min(days, revenue.MAX_DAYS)))
    stmt = (
        select(CreditLedger, User.email).outerjoin(User, User.id == CreditLedger.user_id)
        .where(CreditLedger.created_at >= since).order_by(CreditLedger.id.desc()).limit(MAX_ROWS)
    )
    if workspace_id is not None:
        stmt = stmt.where(CreditLedger.workspace_id == workspace_id)
    return to_csv(
        ["id", "created_at", "workspace_id", "user_email", "kind", "task", "model", "variant", "credits", "platform_credits", "delta", "cost_usd", "note"],
        ([r.id, iso(r.created_at), r.workspace_id, email, r.kind, r.task, r.model, r.variant, r.credits, r.platform_credits, r.delta, r.cost_usd, r.note]
         for r, email in db.execute(stmt).all()),
    )


def orders_csv(db: Session, days: int) -> str:
    return to_csv(
        ["date", "type", "workspace_id", "owner_email", "product", "amount", "currency"],
        ([iso(r["date"]), r["kind"], r["workspace_id"], r["owner_email"], r["product"], r["amount"], r["currency"]] for r in revenue.order_rows(db, days)),
    )


def audit_csv(db: Session, **filters) -> str:
    return to_csv(
        ["id", "created_at", "admin", "action", "target", "detail"],
        ([a.id, a.created_at, a.email, a.action, a.target, a.detail] for a in audit.export_rows(db, **filters)),
    )

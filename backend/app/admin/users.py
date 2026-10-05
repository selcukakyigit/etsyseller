"""Yönetim > Kullanıcılar: filtreli liste ve kullanıcı detayı. Yalnızca okur; işlemler user_actions.py'de.

Plan, kredi ve AI ayarı kullanıcının sahibi olduğu ilk (kişisel) çalışma alanından okunur."""
import datetime as dt
from collections import defaultdict

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.models import AdminAuditLog, AdminUserNote
from app.admin.schemas import (
    AdminUserOut, AuditOut, LedgerRowOut, NoteOut, OnlineUserOut, UserDetailOut, UsersPageOut, UserShopOut, UserSubscriptionOut,
)
from app.auth.access import ONLINE_WINDOW, UserAccess, env_admin, is_online
from app.auth.models import User, Workspace, WorkspaceMember
from app.billing.models import BillingProduct, CreditBalance, CreditLedger, Subscription
from app.billing.service import LIVE_STATUSES, MANUAL_PREFIX
from app.core.dates import iso
from app.shops.models import OAuthToken, Shop

MAX_PAGE = 100
SORTS = ("newest", "oldest", "last_seen")
DETAIL_LEDGER_ROWS = 50


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _primary_ws():
    """Kullanıcı -> sahibi olduğu ilk çalışma alanı."""
    return (
        select(WorkspaceMember.user_id.label("user_id"), func.min(WorkspaceMember.workspace_id).label("workspace_id"))
        .where(WorkspaceMember.role == "owner")
        .group_by(WorkspaceMember.user_id)
        .subquery()
    )


def _filters(q: str, status: str, plan: str, joined_from: dt.date | None, joined_to: dt.date | None, ws, online: bool = False) -> list:
    where = []
    if online:
        where.append(UserAccess.last_seen_at >= dt.datetime.utcnow() - ONLINE_WINDOW)
    if q.strip():
        pattern = f"%{_escape_like(q.strip().lower())}%"
        where.append(or_(func.lower(User.email).like(pattern, escape="\\"), func.lower(User.name).like(pattern, escape="\\")))
    if status == "active":
        where.append(or_(UserAccess.status.is_(None), UserAccess.status == "active"))
    elif status in ("suspended", "blocked"):
        where.append(UserAccess.status == status)
    live = select(Subscription.id).where(Subscription.workspace_id == ws.c.workspace_id, Subscription.status.in_(LIVE_STATUSES))
    if plan == "free":
        where.append(~exists(live))
    elif plan == "paid":
        where.append(exists(live))
    elif plan.isdigit():
        where.append(exists(live.where(Subscription.product_id == int(plan))))
    if joined_from:
        where.append(User.created_at >= dt.datetime.combine(joined_from, dt.time.min))
    if joined_to:
        where.append(User.created_at < dt.datetime.combine(joined_to + dt.timedelta(days=1), dt.time.min))
    return where


def _rows_out(db: Session, rows: list[tuple]) -> list[AdminUserOut]:
    """rows: (User, UserAccess | None, workspace_id | None)."""
    ids = [u.id for u, _, _ in rows]
    ws_ids = [w for _, _, w in rows if w is not None]
    since = dt.datetime.utcnow() - dt.timedelta(days=30)
    ai_counts = dict(
        db.execute(
            select(CreditLedger.user_id, func.count(CreditLedger.id))
            .where(CreditLedger.user_id.in_(ids), CreditLedger.kind == "usage", CreditLedger.created_at >= since)
            .group_by(CreditLedger.user_id)
        ).all()
    )
    balances = {b.workspace_id: b.plan + b.purchased for b in db.scalars(select(CreditBalance).where(CreditBalance.workspace_id.in_(ws_ids))).all()}
    ai_enabled = dict(db.execute(select(Workspace.id, Workspace.ai_enabled).where(Workspace.id.in_(ws_ids))).all())
    plans: dict[int, tuple[str | None, bool]] = {}
    for sub, name in db.execute(
        select(Subscription, BillingProduct.name_en)
        .outerjoin(BillingProduct, BillingProduct.id == Subscription.product_id)
        .where(Subscription.workspace_id.in_(ws_ids), Subscription.status.in_(LIVE_STATUSES))
        .order_by(Subscription.id)
    ).all():
        plans[sub.workspace_id] = (name, sub.lemon_subscription_id.startswith(MANUAL_PREFIX))
    shops: dict[int, list[UserShopOut]] = defaultdict(list)
    for shop, token_shop_id in db.execute(
        select(Shop, OAuthToken.shop_id).outerjoin(OAuthToken, OAuthToken.shop_id == Shop.id).where(Shop.user_id.in_(ids)).order_by(Shop.id)
    ).all():
        revoked = shop.access_revoked_at is not None
        shops[shop.user_id].append(
            UserShopOut(
                id=shop.id, shop_name=shop.shop_name, connected=shop.is_demo or (token_shop_id is not None and not revoked),
                is_demo=shop.is_demo, revoked=revoked, listings_synced_at=iso(shop.listings_synced_at),
            )
        )
    out = []
    for u, acc, wid in rows:
        plan_name, manual = plans.get(wid, (None, False)) if wid else (None, False)
        is_env = env_admin(u)
        out.append(
            AdminUserOut(
                id=u.id, email=u.email, name=u.name, avatar_url=u.avatar_url, created_at=iso(u.created_at),
                last_seen_at=iso(acc.last_seen_at) if acc else None, status=acc.status if acc else "active",
                online=is_online(acc), last_path=acc.last_path if acc else None,
                status_reason=acc.status_reason if acc else None, role="admin" if is_env or (acc is not None and acc.role == "admin") else "user",
                env_admin=is_env, workspace_id=wid, plan=plan_name, plan_manual=manual, credits=balances.get(wid, 0) if wid else 0,
                ai_enabled=ai_enabled.get(wid, True) if wid else True, ai_requests_30d=int(ai_counts.get(u.id, 0)), shops=shops.get(u.id, []),
            )
        )
    return out


def _base(ws):
    return (
        select(User, UserAccess, ws.c.workspace_id)
        .outerjoin(UserAccess, UserAccess.user_id == User.id)
        .outerjoin(ws, ws.c.user_id == User.id)
    )


def list_users(
    db: Session, q: str = "", status: str = "", plan: str = "", joined_from: dt.date | None = None, joined_to: dt.date | None = None,
    sort: str = "newest", limit: int = 50, offset: int = 0, online: bool = False,
) -> UsersPageOut:
    ws = _primary_ws()
    stmt = _base(ws).where(*_filters(q, status, plan, joined_from, joined_to, ws, online))
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    order = {
        "oldest": (User.id.asc(),),
        "last_seen": (UserAccess.last_seen_at.is_(None), UserAccess.last_seen_at.desc(), User.id.desc()),
    }.get(sort, (User.id.desc(),))
    rows = db.execute(stmt.order_by(*order).limit(max(1, min(limit, MAX_PAGE))).offset(max(0, offset))).all()
    return UsersPageOut(items=_rows_out(db, [tuple(r) for r in rows]) if rows else [], total=total)


def get_detail(db: Session, user_id: int) -> UserDetailOut:
    ws = _primary_ws()
    row = db.execute(_base(ws).where(User.id == user_id)).first()
    if row is None:
        raise AdminError(404, "Kullanıcı bulunamadı")
    user_out = _rows_out(db, [tuple(row)])[0]
    wid = row[2]
    balance = db.get(CreditBalance, wid) if wid else None
    subs: list[UserSubscriptionOut] = []
    ledger: list[LedgerRowOut] = []
    if wid:
        for sub, name in db.execute(
            select(Subscription, BillingProduct.name_en).outerjoin(BillingProduct, BillingProduct.id == Subscription.product_id)
            .where(Subscription.workspace_id == wid).order_by(Subscription.id.desc()).limit(10)
        ).all():
            subs.append(UserSubscriptionOut(
                id=sub.id, product=name, status=sub.status, manual=sub.lemon_subscription_id.startswith(MANUAL_PREFIX),
                renews_at=iso(sub.renews_at), ends_at=iso(sub.ends_at),
            ))
        ledger = [
            LedgerRowOut(id=r.id, kind=r.kind, task=r.task, model=r.model, credits=r.credits, delta=r.delta, note=r.note, created_at=iso(r.created_at))
            for r in db.scalars(select(CreditLedger).where(CreditLedger.workspace_id == wid).order_by(CreditLedger.id.desc()).limit(DETAIL_LEDGER_ROWS)).all()
        ]
    notes = [
        NoteOut(id=n.id, author_email=n.author_email, text=n.text, created_at=iso(n.created_at))
        for n in db.scalars(select(AdminUserNote).where(AdminUserNote.user_id == user_id).order_by(AdminUserNote.id.desc())).all()
    ]
    audit = [
        AuditOut(id=a.id, email=a.email, action=a.action, target=a.target, detail=a.detail, created_at=iso(a.created_at))
        for a in db.scalars(select(AdminAuditLog).where(AdminAuditLog.target == f"user:{user_id}").order_by(AdminAuditLog.id.desc()).limit(50)).all()
    ]
    return UserDetailOut(
        user=user_out, balance_plan=balance.plan if balance else 0, balance_purchased=balance.purchased if balance else 0,
        subscriptions=subs, ledger=ledger, notes=notes, audit=audit,
    )


def online_users(db: Session) -> list[OnlineUserOut]:
    """Son ONLINE_WINDOW içinde görülen kullanıcılar, en son görülen en üstte."""
    since = dt.datetime.utcnow() - ONLINE_WINDOW
    rows = db.execute(
        select(User, UserAccess).join(UserAccess, UserAccess.user_id == User.id).where(UserAccess.last_seen_at >= since).order_by(UserAccess.last_seen_at.desc()).limit(200)
    ).all()
    return [
        OnlineUserOut(id=u.id, email=u.email, name=u.name, avatar_url=u.avatar_url, last_seen_at=iso(a.last_seen_at), last_path=a.last_path)
        for u, a in rows
    ]

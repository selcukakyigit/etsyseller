"""Yönetim > Krediler: kredi ayarları, çalışma alanı bakiyeleri, elle düzeltme ve maliyet raporu."""
import datetime as dt

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.schemas import (
    CreditSettingsIn, CreditSettingsOut, WorkspaceCreditOut, WorkspaceCreditsPageOut,
)
from app.auth.models import User, Workspace, WorkspaceMember
from app.billing import credits, settings as credit_settings, usage
from app.billing.models import CreditBalance, CreditLedger
from app.core import app_settings

MAX_PAGE = 100


def get_settings() -> CreditSettingsOut:
    return CreditSettingsOut(**{k: credit_settings.setting(k) for k in credit_settings.DEFAULTS})


def update_settings(db: Session, data: CreditSettingsIn) -> CreditSettingsOut:
    values = data.model_dump(exclude_none=True)
    if values:
        app_settings.set_many(db, values)
    return get_settings()


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_workspaces(db: Session, q: str = "", limit: int = 50, offset: int = 0) -> WorkspaceCreditsPageOut:
    """Çalışma alanları, sahibinin e-postası, bakiye ve son 30 günde harcanan (fiyatlanan) kredi."""
    owner = (
        select(WorkspaceMember.workspace_id, func.min(User.email).label("email"))
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.role == "owner")
        .group_by(WorkspaceMember.workspace_id)
        .subquery()
    )
    stmt = select(Workspace.id, Workspace.name, owner.c.email).outerjoin(owner, owner.c.workspace_id == Workspace.id)
    if q.strip():
        pattern = f"%{_escape_like(q.strip().lower())}%"
        stmt = stmt.where(or_(func.lower(owner.c.email).like(pattern, escape="\\"), func.lower(Workspace.name).like(pattern, escape="\\")))
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.execute(stmt.order_by(Workspace.id.desc()).limit(max(1, min(limit, MAX_PAGE))).offset(max(0, offset))).all()
    ids = [r[0] for r in rows]
    if not ids:
        return WorkspaceCreditsPageOut(items=[], total=total)

    balances = {b.workspace_id: b for b in db.scalars(select(CreditBalance).where(CreditBalance.workspace_id.in_(ids))).all()}
    since = dt.datetime.utcnow() - dt.timedelta(days=30)
    used = dict(
        db.execute(
            select(CreditLedger.workspace_id, func.coalesce(func.sum(CreditLedger.credits), 0))
            .where(CreditLedger.workspace_id.in_(ids), CreditLedger.kind == "usage", CreditLedger.created_at >= since)
            .group_by(CreditLedger.workspace_id)
        ).all()
    )
    items = [
        WorkspaceCreditOut(
            workspace_id=wid, name=name, owner_email=email,
            balance=balances[wid].balance if wid in balances else 0, used_30d=int(used.get(wid, 0)),
        )
        for wid, name, email in rows
    ]
    return WorkspaceCreditsPageOut(items=items, total=total)


def adjust(db: Session, workspace_id: int, amount: int, note: str, admin_id: int) -> None:
    if db.get(Workspace, workspace_id) is None:
        raise AdminError(404, "Çalışma alanı bulunamadı")
    if amount == 0:
        raise AdminError(422, "Miktar 0 olamaz.")
    credits.grant(db, workspace_id, amount, kind="adjust", note=note or "Yönetici düzeltmesi", user_id=admin_id)


def breakdown(db: Session, workspace_id: int | None, days: int = 30) -> dict:
    """Kategori / model / gün dökümü ve sağlayıcı maliyeti, gelir, marj; `workspace_id` None ise bütün çalışma alanları."""
    if workspace_id is not None and db.get(Workspace, workspace_id) is None:
        raise AdminError(404, "Çalışma alanı bulunamadı")
    return usage.breakdown(db, workspace_id, days, include_cost=True)

"""Kullanıcı listesi: arama, sayfalama, bağladığı mağazalar ve son 30 günlük yapay zekâ kullanımı. Yalnızca okur."""
import datetime as dt
from collections import defaultdict

from sqlalchemy import func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.dates import iso
from app.admin.schemas import AdminUserOut, UsersPageOut, UserShopOut
from app.assistant.models import AssistantUsage
from app.auth.models import User, Workspace, WorkspaceMember
from app.billing.models import CreditLedger
from app.shops.models import OAuthToken, Shop

MAX_PAGE = 100


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _ai_counts(db: Session, user_ids: list[int]) -> dict[int, int]:
    """Son 30 günde kullanıcı başına AI çağrısı (tüm görevler, kredi defterinden). Defter yoksa asistan kayıtlarına düşer."""
    since = dt.datetime.utcnow() - dt.timedelta(days=30)
    try:
        return dict(
            db.execute(
                select(CreditLedger.user_id, func.count(CreditLedger.id))
                .where(CreditLedger.user_id.in_(user_ids), CreditLedger.kind == "usage", CreditLedger.created_at >= since)
                .group_by(CreditLedger.user_id)
            ).all()
        )
    except SQLAlchemyError:
        db.rollback()
    return dict(
        db.execute(
            select(AssistantUsage.user_id, func.count(AssistantUsage.id))
            .where(AssistantUsage.user_id.in_(user_ids), AssistantUsage.created_at >= since)
            .group_by(AssistantUsage.user_id)
        ).all()
    )


def list_users(db: Session, q: str = "", limit: int = 50, offset: int = 0) -> UsersPageOut:
    limit = max(1, min(limit, MAX_PAGE))
    offset = max(0, offset)

    where = []
    if q.strip():
        pattern = f"%{_escape_like(q.strip().lower())}%"
        where.append(or_(func.lower(User.email).like(pattern, escape="\\"), func.lower(User.name).like(pattern, escape="\\")))

    total = int(db.scalar(select(func.count(User.id)).where(*where)) or 0)
    users = db.scalars(select(User).where(*where).order_by(User.id.desc()).limit(limit).offset(offset)).all()
    ids = [u.id for u in users]
    if not ids:
        return UsersPageOut(items=[], total=total)

    ai_counts = _ai_counts(db, ids)

    # Kullanıcının sahibi olduğu çalışma alanlarından biri bile yapay zekâyı kapattıysa "kapalı" gösterilir.
    ai_enabled: dict[int, bool] = {}
    for user_id, enabled in db.execute(
        select(WorkspaceMember.user_id, Workspace.ai_enabled)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id.in_(ids), WorkspaceMember.role == "owner")
    ).all():
        ai_enabled[user_id] = ai_enabled.get(user_id, True) and bool(enabled)

    shops: dict[int, list[UserShopOut]] = defaultdict(list)
    for shop, token_shop_id in db.execute(
        select(Shop, OAuthToken.shop_id).outerjoin(OAuthToken, OAuthToken.shop_id == Shop.id).where(Shop.user_id.in_(ids)).order_by(Shop.id)
    ).all():
        revoked = shop.access_revoked_at is not None
        shops[shop.user_id].append(
            UserShopOut(
                id=shop.id,
                shop_name=shop.shop_name,
                connected=shop.is_demo or (token_shop_id is not None and not revoked),
                is_demo=shop.is_demo,
                revoked=revoked,
                listings_synced_at=iso(shop.listings_synced_at),
            )
        )

    items = [
        AdminUserOut(
            id=u.id,
            email=u.email,
            name=u.name,
            avatar_url=u.avatar_url,
            created_at=iso(u.created_at),
            ai_enabled=ai_enabled.get(u.id, True),
            ai_requests_30d=int(ai_counts.get(u.id, 0)),
            shops=shops.get(u.id, []),
        )
        for u in users
    ]
    return UsersPageOut(items=items, total=total)

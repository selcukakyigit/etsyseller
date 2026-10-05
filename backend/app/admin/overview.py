"""Genel bakış: kullanıcı, mağaza, yapay zekâ kullanımı ve destek kutusunun özet sayıları. Yalnızca okur."""
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.admin import system
from app.admin.schemas import ModelUsageOut, OverviewOut
from app.assistant.models import AssistantUsage
from app.auth.access import ONLINE_WINDOW, UserAccess
from app.auth.models import User
from app.billing.models import CreditLedger
from app.contact.models import ContactMessage
from app.shops.models import OAuthToken, Shop


def _count(db: Session, stmt) -> int:
    return int(db.scalar(stmt) or 0)


def _usage_by_model(db: Session, since: dt.datetime) -> list[ModelUsageOut]:
    """Tüm AI görevleri kredi defterinden (billing/metering.py). Defter tablosu yoksa (göç uygulanmamış) yalnızca asistan
    sohbetlerinin kaydına düşülür."""
    try:
        rows = db.execute(
            select(
                CreditLedger.model, func.count(CreditLedger.id),
                func.coalesce(func.sum(CreditLedger.input_tokens), 0), func.coalesce(func.sum(CreditLedger.output_tokens), 0),
            )
            .where(CreditLedger.kind == "usage", CreditLedger.created_at >= since)
            .group_by(CreditLedger.model)
            .order_by(func.count(CreditLedger.id).desc())
        ).all()
        out = []
        for model, n, i, o in rows:
            provider, _, name = (model or "").partition("/")
            out.append(ModelUsageOut(provider=provider, model=name or provider, requests=int(n), input_tokens=int(i), output_tokens=int(o)))
        return out
    except SQLAlchemyError:
        db.rollback()
    rows = db.execute(
        select(
            AssistantUsage.provider, AssistantUsage.model, func.count(AssistantUsage.id),
            func.coalesce(func.sum(AssistantUsage.input_tokens), 0), func.coalesce(func.sum(AssistantUsage.output_tokens), 0),
        )
        .where(AssistantUsage.created_at >= since)
        .group_by(AssistantUsage.provider, AssistantUsage.model)
        .order_by(func.count(AssistantUsage.id).desc())
    ).all()
    return [ModelUsageOut(provider=p, model=m, requests=int(n), input_tokens=int(i), output_tokens=int(o)) for p, m, n, i, o in rows]


def _seen_since(db: Session, since: dt.datetime) -> int:
    try:
        return _count(db, select(func.count(UserAccess.user_id)).where(UserAccess.last_seen_at >= since))
    except SQLAlchemyError:
        db.rollback()
        return 0


def _users_since(db: Session, since: dt.datetime) -> int:
    return _count(db, select(func.count(User.id)).where(User.created_at >= since))


def get_overview(db: Session) -> OverviewOut:
    now = dt.datetime.utcnow()
    since_30 = now - dt.timedelta(days=30)

    real_shops = select(func.count(Shop.id)).where(Shop.is_demo.is_(False))
    connected = real_shops.join(OAuthToken, OAuthToken.shop_id == Shop.id).where(Shop.access_revoked_at.is_(None))

    by_model = _usage_by_model(db, since_30)
    etsy = system.etsy_usage()

    return OverviewOut(
        users_total=_count(db, select(func.count(User.id))),
        users_7d=_users_since(db, now - dt.timedelta(days=7)),
        users_30d=_users_since(db, since_30),
        shops_connected=_count(db, connected),
        shops_revoked=_count(db, real_shops.where(Shop.access_revoked_at.is_not(None))),
        shops_demo=_count(db, select(func.count(Shop.id)).where(Shop.is_demo.is_(True))),
        ai_requests_30d=sum(m.requests for m in by_model),
        ai_input_tokens_30d=sum(m.input_tokens for m in by_model),
        ai_output_tokens_30d=sum(m.output_tokens for m in by_model),
        ai_by_model=by_model,
        open_messages=_count(db, select(func.count(ContactMessage.id)).where(ContactMessage.handled.is_(False))),
        etsy_calls_today=etsy["calls_today"],
        etsy_daily_limit=etsy["daily_limit"],
        online_now=_seen_since(db, now - ONLINE_WINDOW),
        active_24h=_seen_since(db, now - dt.timedelta(hours=24)),
    )

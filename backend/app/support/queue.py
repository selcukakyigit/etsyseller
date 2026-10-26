"""Yönetici kuyruğu: görünümler (bana atanan, atanmamış, geciken…), sayfalı liste, sayaçlar, ekip listesi ve yönetici çıktıları.
Talebin durum değişiklikleri service.py'dedir; burası yalnızca okur ve biçimlendirir."""
import datetime as dt
import json
import math

from sqlalchemy import and_, case, exists, func, or_, select, true
from sqlalchemy.orm import Session

from app.auth.access import UserAccess
from app.auth.models import User
from app.core.config import settings
from app.core.dates import iso
from app.support import service, taxonomy
from app.support.models import Ticket, TicketLabel

PAGE_SIZE = 25


def staff(db: Session) -> list[User]:
    """Atanabilecek yöneticiler: ADMIN_EMAILS'tekiler ve panelden rol verilenler."""
    emails = [e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()]
    stmt = select(User).outerjoin(UserAccess, UserAccess.user_id == User.id).where(or_(func.lower(User.email).in_(emails), UserAccess.role == "admin"))
    return list(db.scalars(stmt.order_by(User.name, User.email)))


def _person(u: User | None) -> dict | None:
    return {"id": u.id, "email": u.email, "name": u.name} if u else None


def options(db: Session) -> dict:
    return {
        "labels": taxonomy.label_options(), "staff": [_person(u) for u in staff(db)], "views": list(taxonomy.VIEWS),
        "priorities": list(taxonomy.PRIORITIES), "overdue_hours": taxonomy.OVERDUE_HOURS,
    }


def _view_clauses(admin: User) -> dict:
    cut = dt.datetime.utcnow() - dt.timedelta(hours=taxonomy.OVERDUE_HOURS)
    live = Ticket.status != "resolved"
    return {
        "open": live,
        "mine": and_(live, Ticket.assignee_id == admin.id),
        "unassigned": and_(live, Ticket.assignee_id.is_(None)),
        "unread": Ticket.admin_unread.is_(True),
        "waiting": Ticket.status == "waiting_user",
        "overdue": and_(Ticket.status == "open", Ticket.updated_at < cut),
        "resolved": Ticket.status == "resolved",
        "all": true(),
    }


def counts(db: Session, admin: User) -> dict[str, int]:
    """Her görünümdeki talep sayısı (sekme rozetleri için tek sorgu)."""
    clauses = _view_clauses(admin)
    row = db.execute(select(*[func.coalesce(func.sum(case((c, 1), else_=0)), 0) for c in clauses.values()])).one()
    return dict(zip(clauses, (int(n) for n in row)))


def list_page(db: Session, admin: User, *, view: str, q: str = "", label: str = "", priority: str = "", category: str = "", page: int = 0) -> dict:
    """Sayfalı liste. Okunmamışlar üstte, sonra öncelik, sonra son hareket. `q`: konu, e-posta ya da talep numarası (#12)."""
    where = [_view_clauses(admin).get(view, true())]
    text = q.strip().lstrip("#")
    if text:
        like = f"%{text.lower()}%"
        by_text = or_(func.lower(Ticket.subject).like(like), func.lower(User.email).like(like))
        where.append(or_(by_text, Ticket.id == int(text)) if text.isdigit() else by_text)
    if label in taxonomy.LABELS:
        where.append(exists().where(TicketLabel.ticket_id == Ticket.id, TicketLabel.label == label))
    if priority in taxonomy.PRIORITIES:
        where.append(Ticket.priority == priority)
    if category in taxonomy.CATEGORIES:
        where.append(Ticket.category == category)
    base = select(Ticket, User).join(User, User.id == Ticket.user_id).where(*where)
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rank = case((Ticket.priority == "urgent", 0), (Ticket.priority == "normal", 1), else_=2)
    page = max(0, page)
    rows = db.execute(base.order_by(Ticket.admin_unread.desc(), rank, Ticket.updated_at.desc()).limit(PAGE_SIZE).offset(page * PAGE_SIZE)).all()
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_({t.assignee_id for t, _ in rows if t.assignee_id})))} if rows else {}
    return {
        "items": [summary(t, u, people.get(t.assignee_id)) for t, u in rows], "total": total, "page": page,
        "pages": max(1, math.ceil(total / PAGE_SIZE)), "counts": counts(db, admin),
    }


def summary(t: Ticket, user: User, assignee: User | None) -> dict:
    return {
        **service.summary_out(t), "user": _person(user), "admin_unread": t.admin_unread, "priority": t.priority, "source": t.source,
        "assignee": _person(assignee), "labels": [l.label for l in t.labels],
    }


def detail(db: Session, t: Ticket) -> dict:
    """Talebin yönetici görünümü: tüm mesajlar (iç notlar dahil), bağlam, aynı hatayı bildirenler, iş kaydı ve etiket önerisi."""
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_({t.user_id, t.assignee_id, *(e.actor_id for e in t.events)} - {None})))}
    first = next((m.body for m in t.messages if m.author_kind == "user"), "")
    return {
        **summary(t, people[t.user_id], people.get(t.assignee_id)), "context": json.loads(t.context_json or "{}"),
        "messages": [service.message_out(m) for m in t.messages],
        "similar": [{"id": o.id, "subject": o.subject, "status": o.status} for o in service.similar(db, t)], "error_count": service.error_count(db, t),
        "events": [
            {"id": e.id, "kind": e.kind, "detail": e.detail, "actor": (people[e.actor_id].name or people[e.actor_id].email) if e.actor_id in people else None, "created_at": iso(e.created_at)}
            for e in t.events
        ],
        "suggested_labels": [] if t.labels else taxonomy.suggest_labels(t.subject, first),
        "first_response_at": iso(t.first_response_at), "resolved_at": iso(t.resolved_at),
    }

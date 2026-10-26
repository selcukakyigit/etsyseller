"""Destek raporu: son N günde açılan taleplerin konu/tür/kaynak dağılımı, ilk yanıt ve çözüm süreleri, memnuniyet.
Hangi ekranın kullanıcıyı zorladığını ve ekibin ne kadar hızlı döndüğünü gösterir."""
import datetime as dt
import statistics

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.support.models import Ticket, TicketLabel

MAX_DAYS = 365


def _median_hours(deltas: list[dt.timedelta]) -> float | None:
    return round(statistics.median(d.total_seconds() for d in deltas) / 3600, 1) if deltas else None


def _counts(db: Session, column, since: dt.datetime) -> dict[str, int]:
    rows = db.execute(select(column, func.count(Ticket.id)).where(Ticket.created_at >= since).group_by(column).order_by(func.count(Ticket.id).desc()))
    return {str(k): int(n) for k, n in rows}


def build(db: Session, days: int = 30) -> dict:
    days = max(1, min(days, MAX_DAYS))
    since = dt.datetime.utcnow() - dt.timedelta(days=days)
    rows = db.execute(select(Ticket.created_at, Ticket.first_response_at, Ticket.resolved_at, Ticket.status, Ticket.rating).where(Ticket.created_at >= since)).all()
    labelled = (
        select(TicketLabel.label, func.count(TicketLabel.ticket_id)).join(Ticket, Ticket.id == TicketLabel.ticket_id)
        .where(Ticket.created_at >= since).group_by(TicketLabel.label).order_by(func.count(TicketLabel.ticket_id).desc())
    )
    unlabelled = select(func.count(Ticket.id)).where(Ticket.created_at >= since, ~Ticket.labels.any())
    return {
        "days": days,
        "created": len(rows),
        "resolved": sum(1 for r in rows if r.status == "resolved"),
        "open_now": int(db.scalar(select(func.count(Ticket.id)).where(Ticket.status != "resolved")) or 0),
        "first_response_hours": _median_hours([r.first_response_at - r.created_at for r in rows if r.first_response_at]),
        "resolution_hours": _median_hours([r.resolved_at - r.created_at for r in rows if r.resolved_at]),
        "rating_up": sum(1 for r in rows if r.rating == 1),
        "rating_down": sum(1 for r in rows if r.rating == -1),
        "by_category": _counts(db, Ticket.category, since),
        "by_source": _counts(db, Ticket.source, since),
        "by_label": {k: int(n) for k, n in db.execute(labelled)},
        "unlabelled": int(db.scalar(unlabelled) or 0),
    }

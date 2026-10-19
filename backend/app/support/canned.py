"""Hazır yanıtlar (yalnızca yöneticiler)."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.support.models import CannedReply

MAX_REPLIES = 100


def _out(r: CannedReply) -> dict:
    return {"id": r.id, "title": r.title, "body": r.body}


def _get(db: Session, reply_id: int) -> CannedReply:
    row = db.get(CannedReply, reply_id)
    if row is None:
        raise HTTPException(404, tr("Hazır yanıt bulunamadı", "Canned reply not found"))
    return row


def list_all(db: Session) -> list[dict]:
    return [_out(r) for r in db.scalars(select(CannedReply).order_by(CannedReply.title)).all()]


def save(db: Session, reply_id: int | None, title: str, body: str) -> dict:
    if reply_id is None:
        if len(list_all(db)) >= MAX_REPLIES:
            raise HTTPException(422, tr(f"En fazla {MAX_REPLIES} hazır yanıt kaydedilebilir", f"You can save up to {MAX_REPLIES} canned replies"))
        row = CannedReply(title=title.strip(), body=body.strip())
        db.add(row)
    else:
        row = _get(db, reply_id)
        row.title, row.body = title.strip(), body.strip()
    db.commit()
    return _out(row)


def delete(db: Session, reply_id: int) -> None:
    db.delete(_get(db, reply_id))
    db.commit()

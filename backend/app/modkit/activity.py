"""Kayıt akışı / denetim kaydı. `log` commit etmez: olayı yaratan işlemle aynı işlemde yazılır (biri olur da öteki
olmaz durumu yok)."""
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.modkit.access import EntityAccess
from app.modkit.models import EntityActivity


def log(db: Session, entity_id: int, actor: User | None, kind: str, data: dict | None = None, internal: bool = False) -> None:
    db.add(EntityActivity(
        entity_id=entity_id, actor_id=actor.id if actor else None, kind=kind,
        data_json=json.dumps(data or {}, ensure_ascii=False, default=str), internal=internal,
    ))


def recent(db: Session, access: EntityAccess, limit: int = 30) -> list[dict]:
    stmt = select(EntityActivity, User.name, User.email).outerjoin(User, User.id == EntityActivity.actor_id).where(
        EntityActivity.entity_id == access.entity.id
    )
    if not access.internal:
        stmt = stmt.where(EntityActivity.internal.is_(False))
    rows = db.execute(stmt.order_by(EntityActivity.created_at.desc(), EntityActivity.id.desc()).limit(limit)).all()
    return [
        {
            "id": a.id, "kind": a.kind, "data": json.loads(a.data_json or "{}"),
            "actor": (name or email or "") if (name or email) else "",
            "created_at": a.created_at.isoformat() + "Z",
        }
        for a, name, email in rows
    ]

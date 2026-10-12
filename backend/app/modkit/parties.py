"""Dış paylar: maliyetin kendi mağazalarına yazılmayan payının sahipleri (başka hesaptaki mağaza, yerel satış, ortak…).
Çalışma alanı seviyesindedir, bütün modüller kullanır. Kullanılmış kayıt silinmez, arşive alınır."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.modkit.access import EntityAccess
from app.modkit.models import ExternalParty

MAX_PARTIES = 50


def serialize(p: ExternalParty) -> dict:
    return {"id": p.id, "name": p.name, "archived": p.archived}


def list_parties(db: Session, access: EntityAccess) -> list[dict]:
    access.require_member()
    rows = db.scalars(select(ExternalParty).where(ExternalParty.workspace_id == access.entity.workspace_id).order_by(ExternalParty.archived, ExternalParty.name))
    return [serialize(p) for p in rows]


def get(db: Session, workspace_id: int, party_id: int | None) -> ExternalParty:
    party = db.get(ExternalParty, party_id) if party_id else None
    if party is None or party.workspace_id != workspace_id:
        raise HTTPException(404, tr("Dış pay sahibi bulunamadı", "External share owner not found"))
    return party


def create(db: Session, access: EntityAccess, name: str) -> dict:
    access.require_member()
    name = " ".join(name.split())[:80]
    if not name:
        raise HTTPException(422, tr("Bir ad yaz.", "Enter a name."))
    wid = access.entity.workspace_id
    existing = db.scalar(select(ExternalParty).where(ExternalParty.workspace_id == wid, ExternalParty.name == name))
    if existing is not None:  # aynı ad: arşivdeyse geri getir
        existing.archived = False
        db.commit()
        return serialize(existing)
    if len(list_parties(db, access)) >= MAX_PARTIES:
        raise HTTPException(422, tr("Dış pay sahibi sınırına ulaşıldı.", "Limit of external share owners reached."))
    party = ExternalParty(workspace_id=wid, name=name)
    db.add(party)
    db.commit()
    return serialize(party)


def update(db: Session, access: EntityAccess, party_id: int, name: str | None, archived: bool | None) -> dict:
    access.require_member()
    party = get(db, access.entity.workspace_id, party_id)
    if name is not None:
        name = " ".join(name.split())[:80]
        if not name:
            raise HTTPException(422, tr("Bir ad yaz.", "Enter a name."))
        clash = db.scalar(select(ExternalParty.id).where(ExternalParty.workspace_id == party.workspace_id, ExternalParty.name == name, ExternalParty.id != party.id))
        if clash:
            raise HTTPException(409, tr("Bu ad zaten kullanılıyor.", "This name is already in use."))
        party.name = name
    if archived is not None:
        party.archived = archived
    db.commit()
    return serialize(party)

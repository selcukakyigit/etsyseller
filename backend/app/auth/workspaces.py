"""Çalışma alanı (workspace) yardımcıları: kullanıcının erişebildiği alanlar ve ilk giriş kurulumu."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User, Workspace, WorkspaceMember


def workspace_ids(db: Session, user: User) -> list[int]:
    return list(db.scalars(select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)))


def primary_workspace(db: Session, user: User) -> Workspace:
    """Kullanıcının ilk (kişisel) çalışma alanı; yoksa oluşturur."""
    ws = db.scalars(
        select(Workspace).join(WorkspaceMember).where(WorkspaceMember.user_id == user.id).order_by(Workspace.id).limit(1)
    ).first()
    if ws is None:
        ws = create_personal_workspace(db, user)
    return ws


def create_personal_workspace(db: Session, user: User) -> Workspace:
    ws = Workspace(name=(user.name or user.email.split("@")[0]) + " çalışma alanı")
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    db.commit()
    return ws

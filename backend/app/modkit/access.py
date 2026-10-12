"""Modül kayıtlarında yetki. Her uç nokta `entity_access(module)` bağımlılığından geçer; kayda erişimi olmayan
kullanıcı 404 alır (kaydın var olduğu bile sızmaz).

Üç rol:
- member  — kaydın çalışma alanının yazma yetkili üyesi (owner/admin/editor): her şeyi yapabilir.
- viewer  — çalışma alanının "viewer" üyesi: yalnızca görür.
- guest   — davetle gelen dış kullanıcı (ör. tedarikçinin kendisi): `ShareGrant.permissions` neye izin veriyorsa.
            Mağaza, sipariş, finans ve ürün dağıtımı gibi iç verileri hiçbir zaman göremez.
"""
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User, WorkspaceMember
from app.core.db import get_db
from app.core.deps import get_current_user
from app.modkit.models import ModuleEntity, ShareGrant

# Misafire verilebilen izinler. Görme (view) her misafirde örtüktür.
GUEST_PERMS = ("prices.edit", "jobs.create", "documents.upload")
WRITE_ROLES = ("owner", "admin", "editor")


def parse_perms(raw: str | None) -> frozenset[str]:
    return frozenset(p for p in (raw or "").split(",") if p in GUEST_PERMS)


def format_perms(perms) -> str:
    return ",".join(p for p in GUEST_PERMS if p in set(perms))


@dataclass(frozen=True)
class EntityAccess:
    entity: ModuleEntity
    user: User
    role: str  # member | viewer | guest
    perms: frozenset[str]

    @property
    def is_member(self) -> bool:
        return self.role == "member"

    @property
    def is_guest(self) -> bool:
        return self.role == "guest"

    @property
    def internal(self) -> bool:
        """Çalışma alanının kendi kullanıcısı mı (iç veriyi görebilir mi)."""
        return self.role in ("member", "viewer")

    def can(self, perm: str) -> bool:
        if self.role == "member":
            return True
        if self.role == "guest":
            return perm in self.perms
        return False

    def require(self, perm: str) -> None:
        if not self.can(perm):
            raise HTTPException(403, "Bu işlem için yetkin yok")

    def require_member(self) -> None:
        if not self.is_member:
            raise HTTPException(403, "Bu işlem için yetkin yok")

    def summary(self) -> dict:
        return {"role": self.role, "permissions": sorted(self.perms) if self.is_guest else (list(GUEST_PERMS) if self.is_member else [])}


def _member_role(db: Session, user: User, workspace_id: int) -> str | None:
    return db.scalar(select(WorkspaceMember.role).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user.id))


def resolve(db: Session, user: User, entity_id: int, module: str) -> EntityAccess:
    entity = db.get(ModuleEntity, entity_id)
    if entity is None or entity.module != module:
        raise HTTPException(404, "Kayıt bulunamadı")
    role = _member_role(db, user, entity.workspace_id)
    if role is not None:
        return EntityAccess(entity, user, "member" if role in WRITE_ROLES else "viewer", frozenset())
    grant = db.scalar(select(ShareGrant).where(ShareGrant.entity_id == entity.id, ShareGrant.user_id == user.id))
    if grant is None or entity.archived_at is not None:  # arşivlenmiş kayıt misafire kapanır
        raise HTTPException(404, "Kayıt bulunamadı")
    return EntityAccess(entity, user, "guest", parse_perms(grant.permissions))


def entity_access(module: str):
    """Yol parametresi `entity_id` olan uç noktalar için bağımlılık üretir."""

    def dep(entity_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> EntityAccess:
        return resolve(db, user, entity_id, module)

    return dep


def accessible(db: Session, user: User, module: str) -> tuple[list[tuple[ModuleEntity, str]], list[ModuleEntity]]:
    """(kullanıcının çalışma alanlarındaki kayıtlar + rolü, misafir olarak paylaşılan kayıtlar)."""
    roles = dict(db.execute(select(WorkspaceMember.workspace_id, WorkspaceMember.role).where(WorkspaceMember.user_id == user.id)).all())
    own = []
    if roles:
        for e in db.scalars(
            select(ModuleEntity).where(ModuleEntity.workspace_id.in_(roles), ModuleEntity.module == module).order_by(ModuleEntity.name)
        ):
            own.append((e, "member" if roles[e.workspace_id] in WRITE_ROLES else "viewer"))
    shared = list(db.scalars(
        select(ModuleEntity).join(ShareGrant, ShareGrant.entity_id == ModuleEntity.id)
        .where(ShareGrant.user_id == user.id, ModuleEntity.module == module, ModuleEntity.archived_at.is_(None),
               ModuleEntity.workspace_id.not_in(roles) if roles else True)
        .order_by(ModuleEntity.name)
    ))
    return own, shared


def writable_workspace(db: Session, user: User) -> int:
    """Yeni kaydın açılacağı çalışma alanı: kullanıcının yazma yetkili olduğu ilk (kişisel) alan."""
    wid = db.scalar(
        select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id, WorkspaceMember.role.in_(WRITE_ROLES))
        .order_by(WorkspaceMember.workspace_id).limit(1)
    )
    if wid is None:
        raise HTTPException(403, "Bu işlem için yetkin yok")
    return wid

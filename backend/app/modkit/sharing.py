"""Davet ve kayıt düzeyinde erişim.

Akış: üye davet eder → e-postaya tek kullanımlık bağlantı gider → davet edilen kişi o e-postayla giriş yapar / hesap
açar → davet kabul edilir ve kişiye yalnızca o kayda `ShareGrant` verilir (çalışma alanı üyesi olmaz).

Güvenlik:
- Belirteç 32 bayt rastgele (secrets.token_urlsafe); veritabanında yalnızca SHA-256 özeti tutulur.
- 7 gün geçerli, tek kullanımlık, geri alınabilir; yeniden gönderimde belirteç yenilenir (eski bağlantı ölür).
- Yalnızca davet edilen e-postayla giriş yapan hesap kabul edebilir. Şifreyi Ulagg tutmaz: giriş Supabase'dedir
  (e-posta doğrulaması orada yapılır), Ulagg yalnızca doğrulanmış oturumun e-postasını karşılaştırır.
- Davet gönderme, yeniden gönderme, bağlantı sorgulama ve kabul hız sınırlıdır.
"""
import datetime as dt
import hashlib
import re
import secrets

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User, Workspace, WorkspaceMember
from app.core.i18n import get_lang
from app.modkit import activity, mailer, ratelimit
from app.modkit.access import EntityAccess, format_perms, parse_perms
from app.modkit.models import ModuleEntity, ShareGrant, ShareInvite

INVITE_DAYS = 7
MAX_PENDING_PER_ENTITY = 20
MAX_GRANTS_PER_ENTITY = 20
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> dt.datetime:
    return dt.datetime.utcnow()


def _clean_email(email: str) -> str:
    email = (email or "").strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 255:
        raise HTTPException(422, "Geçerli bir e-posta adresi yaz")
    return email


def _pending(inv: ShareInvite) -> bool:
    return inv.accepted_at is None and inv.revoked_at is None and inv.expires_at > _now()


def _status(inv: ShareInvite) -> str:
    if inv.revoked_at is not None:
        return "revoked"
    if inv.accepted_at is not None:
        return "accepted"
    if inv.expires_at <= _now():
        return "expired"
    return "pending"


def _issue(inv: ShareInvite) -> str:
    token = secrets.token_urlsafe(32)
    inv.token_hash = _hash(token)
    inv.expires_at = _now() + dt.timedelta(days=INVITE_DAYS)
    inv.last_sent_at = _now()
    inv.send_count = (inv.send_count or 0) + 1
    return token


def _send(db: Session, access: EntityAccess, inv: ShareInvite, token: str) -> bool:
    ws = db.get(Workspace, access.entity.workspace_id)
    inviter = access.user.name or access.user.email
    url = mailer.site_url(f"/invite/{token}")
    return mailer.send_invite(inv.email, get_lang() == "en", inviter, access.entity.name, ws.name if ws else "", url, INVITE_DAYS)


def create(db: Session, access: EntityAccess, email: str, perms: list[str]) -> dict:
    access.require_member()
    email = _clean_email(email)
    ratelimit.hit("invite.create", f"ws:{access.entity.workspace_id}", 30, 3600)
    ratelimit.hit("invite.create", f"user:{access.user.id}", 30, 3600)
    if email == access.user.email.lower():
        raise HTTPException(422, "Kendini davet edemezsin")
    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user is not None:
        if db.scalar(select(WorkspaceMember.id).where(WorkspaceMember.workspace_id == access.entity.workspace_id, WorkspaceMember.user_id == existing_user.id)):
            raise HTTPException(409, "Bu kişi zaten çalışma alanının üyesi")
        if db.scalar(select(ShareGrant.id).where(ShareGrant.entity_id == access.entity.id, ShareGrant.user_id == existing_user.id)):
            raise HTTPException(409, "Bu kişinin zaten erişimi var")
    invites = list(db.scalars(select(ShareInvite).where(ShareInvite.entity_id == access.entity.id)))
    if sum(1 for i in invites if _pending(i)) >= MAX_PENDING_PER_ENTITY:
        raise HTTPException(422, "Bekleyen davet sınırına ulaşıldı")
    # Aynı e-postaya bekleyen davet varsa iptal edilir: tek geçerli bağlantı kalsın.
    for i in invites:
        if i.email == email and _pending(i):
            i.revoked_at = _now()
    inv = ShareInvite(entity_id=access.entity.id, email=email, permissions=format_perms(perms), invited_by=access.user.id, token_hash="")
    token = _issue(inv)
    db.add(inv)
    activity.log(db, access.entity.id, access.user, "invite_sent", {"email": email}, internal=True)
    db.commit()
    sent = _send(db, access, inv, token)
    return {"id": inv.id, "sent": sent}


def resend(db: Session, access: EntityAccess, invite_id: int) -> dict:
    access.require_member()
    inv = _get_invite(db, access, invite_id)
    if inv.accepted_at is not None or inv.revoked_at is not None:
        raise HTTPException(409, "Bu davet artık geçerli değil")
    if inv.last_sent_at and _now() - inv.last_sent_at < dt.timedelta(seconds=60):
        raise HTTPException(429, "Çok fazla istek gönderildi. Biraz sonra tekrar dene.")
    ratelimit.hit("invite.resend", f"inv:{inv.id}", 5, 86400)
    token = _issue(inv)
    db.commit()
    return {"id": inv.id, "sent": _send(db, access, inv, token)}


def revoke(db: Session, access: EntityAccess, invite_id: int) -> None:
    access.require_member()
    inv = _get_invite(db, access, invite_id)
    if inv.accepted_at is None and inv.revoked_at is None:
        inv.revoked_at = _now()
        activity.log(db, access.entity.id, access.user, "invite_revoked", {"email": inv.email}, internal=True)
        db.commit()


def _get_invite(db: Session, access: EntityAccess, invite_id: int) -> ShareInvite:
    inv = db.get(ShareInvite, invite_id)
    if inv is None or inv.entity_id != access.entity.id:
        raise HTTPException(404, "Davet bulunamadı")
    return inv


def overview(db: Session, access: EntityAccess) -> dict:
    access.require_member()
    invites = db.scalars(select(ShareInvite).where(ShareInvite.entity_id == access.entity.id).order_by(ShareInvite.created_at.desc()).limit(50)).all()
    grants = db.execute(
        select(ShareGrant, User.email, User.name).join(User, User.id == ShareGrant.user_id)
        .where(ShareGrant.entity_id == access.entity.id).order_by(ShareGrant.created_at)
    ).all()
    return {
        "invites": [
            {"id": i.id, "email": i.email, "permissions": sorted(parse_perms(i.permissions)), "status": _status(i),
             "expires_at": i.expires_at.isoformat() + "Z", "created_at": i.created_at.isoformat() + "Z"}
            for i in invites if _status(i) in ("pending", "expired")
        ],
        "grants": [
            {"id": g.id, "email": email, "name": name or "", "permissions": sorted(parse_perms(g.permissions)), "created_at": g.created_at.isoformat() + "Z"}
            for g, email, name in grants
        ],
    }


def update_grant(db: Session, access: EntityAccess, grant_id: int, perms: list[str]) -> None:
    access.require_member()
    g = db.get(ShareGrant, grant_id)
    if g is None or g.entity_id != access.entity.id:
        raise HTTPException(404, "Erişim bulunamadı")
    g.permissions = format_perms(perms)
    activity.log(db, access.entity.id, access.user, "access_changed", {"user_id": g.user_id}, internal=True)
    db.commit()


def remove_grant(db: Session, access: EntityAccess, grant_id: int) -> None:
    access.require_member()
    g = db.get(ShareGrant, grant_id)
    if g is None or g.entity_id != access.entity.id:
        raise HTTPException(404, "Erişim bulunamadı")
    email = db.scalar(select(User.email).where(User.id == g.user_id))
    db.delete(g)
    activity.log(db, access.entity.id, access.user, "access_removed", {"email": email}, internal=True)
    db.commit()


def leave(db: Session, access: EntityAccess) -> None:
    """Misafir kendi erişimini bırakır."""
    if not access.is_guest:
        raise HTTPException(409, "Bu işlem için yetkin yok")
    g = db.scalar(select(ShareGrant).where(ShareGrant.entity_id == access.entity.id, ShareGrant.user_id == access.user.id))
    if g is not None:
        db.delete(g)
        activity.log(db, access.entity.id, access.user, "access_left", {})
        db.commit()


# --------------------------------------------------------------- davet edilen tarafı ----

def _by_token(db: Session, token: str) -> ShareInvite | None:
    if not token or len(token) > 100:
        return None
    return db.scalar(select(ShareInvite).where(ShareInvite.token_hash == _hash(token)))


def lookup(db: Session, token: str, ip: str) -> dict:
    """Bağlantıyı açan kişiye davetin özeti (giriş gerektirmez; belirteci bilen zaten davetlidir)."""
    ratelimit.hit("invite.lookup", ip, 60, 600)
    inv = _by_token(db, token)
    if inv is None:
        raise HTTPException(404, "Davet bulunamadı")
    entity = db.get(ModuleEntity, inv.entity_id)
    ws = db.get(Workspace, entity.workspace_id) if entity else None
    inviter = db.get(User, inv.invited_by) if inv.invited_by else None
    return {
        "status": _status(inv), "email": inv.email, "module": entity.module if entity else "",
        "entity_name": entity.name if entity else "", "workspace_name": ws.name if ws else "",
        "inviter": (inviter.name or inviter.email) if inviter else "",
        "expires_at": inv.expires_at.isoformat() + "Z",
    }


def accept(db: Session, token: str, user: User) -> dict:
    ratelimit.hit("invite.accept", f"user:{user.id}", 20, 600)
    inv = _by_token(db, token)
    if inv is None:
        raise HTTPException(404, "Davet bulunamadı")
    status = _status(inv)
    if status != "pending" and not (status == "accepted" and inv.accepted_by == user.id):
        raise HTTPException(410, "Bu davet artık geçerli değil")
    if user.email.lower() != inv.email:
        raise HTTPException(403, "Bu davet başka bir e-posta adresine gönderildi. O adresle giriş yap.")
    entity = db.get(ModuleEntity, inv.entity_id)
    if entity is None or entity.archived_at is not None:
        raise HTTPException(410, "Bu davet artık geçerli değil")
    if status == "pending":
        member = db.scalar(select(WorkspaceMember.id).where(WorkspaceMember.workspace_id == entity.workspace_id, WorkspaceMember.user_id == user.id))
        if member is None:
            grants = db.scalars(select(ShareGrant).where(ShareGrant.entity_id == entity.id)).all()
            grant = next((g for g in grants if g.user_id == user.id), None)
            if grant is None:
                if len(grants) >= MAX_GRANTS_PER_ENTITY:
                    raise HTTPException(422, "Bu kayıt için erişim sınırına ulaşıldı")
                db.add(ShareGrant(entity_id=entity.id, user_id=user.id, permissions=inv.permissions, granted_by=inv.invited_by))
            else:
                grant.permissions = inv.permissions
        inv.accepted_at = _now()
        inv.accepted_by = user.id
        activity.log(db, entity.id, user, "invite_accepted", {"email": user.email})
        db.commit()
        mailer.notify_members(
            db, entity, "invite_accepted",
            f"{user.email} daveti kabul etti", f"{user.email} accepted the invitation",
            [("Kayıt", entity.name)], [("Record", entity.name)], f"/{entity.module}/{entity.id}?tab=sharing",
        )
    return {"module": entity.module, "entity_id": entity.id}

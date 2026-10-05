"""Yönetim > Kullanıcılar işlemleri: kredi, not, plan atama, şifre sıfırlama, rol, durum (askıya alma / engelleme), silme
ve toplu işlemler.

Güvenlik kuralları: yönetici kendi hesabını askıya alamaz/engelleyemez/silemez/rolünü düşüremez; ADMIN_EMAILS'ten
gelen yöneticiye panelden dokunulmaz; yönetici rolündeki hesap önce kullanıcıya çevrilmeden askıya alınamaz."""
import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.models import AdminUserNote
from app.admin.schemas import BulkResultOut
from app.auth import access, supabase_admin
from app.auth.models import User, WorkspaceMember
from app.billing import credits
from app.billing import service as billing
from app.billing.models import BillingProduct
from app.core.config import settings
from app.emails.renderer import render
from app.emails.sender import send_email


def _user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise AdminError(404, "Kullanıcı bulunamadı")
    return user


def _workspace_id(db: Session, user: User) -> int:
    wid = db.scalar(
        select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id, WorkspaceMember.role == "owner").order_by(WorkspaceMember.workspace_id).limit(1)
    )
    if wid is None:
        raise AdminError(409, "Kullanıcının çalışma alanı yok.")
    return wid


def _guard_target(db: Session, admin: User, user: User) -> None:
    if user.id == admin.id:
        raise AdminError(409, "Bu işlemi kendi hesabına uygulayamazsın.")
    if access.env_admin(user):
        raise AdminError(409, "Sunucu ayarındaki (ADMIN_EMAILS) yöneticiye panelden dokunulamaz.")


def add_credits(db: Session, admin: User, user_id: int, amount: int, bucket: str, note: str) -> None:
    if amount == 0:
        raise AdminError(422, "Miktar 0 olamaz.")
    user = _user(db, user_id)
    credits.grant(db, _workspace_id(db, user), amount, kind="adjust", bucket=bucket, note=note or "Yönetici düzeltmesi", user_id=admin.id)


def add_note(db: Session, admin: User, user_id: int, text: str) -> None:
    _user(db, user_id)
    db.add(AdminUserNote(user_id=user_id, author_id=admin.id, author_email=admin.email, text=text.strip()))
    db.commit()


def delete_note(db: Session, user_id: int, note_id: int) -> None:
    note = db.get(AdminUserNote, note_id)
    if note is None or note.user_id != user_id:
        raise AdminError(404, "Not bulunamadı")
    db.delete(note)
    db.commit()


def assign_plan(db: Session, user_id: int, product_id: int, months: int) -> None:
    user = _user(db, user_id)
    product = db.get(BillingProduct, product_id)
    if product is None or product.kind != "plan":
        raise AdminError(404, "Plan bulunamadı")
    try:
        billing.assign_manual_plan(db, _workspace_id(db, user), product, months)
    except billing.EventError as exc:
        raise AdminError(409, str(exc)) from exc


def end_plan(db: Session, user_id: int) -> None:
    """Elle verilen planı hemen bitirir. Ücretli (Lemon) abonelik buradan iptal edilmez; kullanıcı ya da Lemon panelinden."""
    user = _user(db, user_id)
    row = billing.live_subscription(db, _workspace_id(db, user))
    if row is None:
        raise AdminError(404, "Aktif plan yok.")
    if not row.lemon_subscription_id.startswith(billing.MANUAL_PREFIX):
        raise AdminError(409, "Ücretli abonelik Lemon Squeezy panelinden iptal edilir.")
    billing.end_manual_plan(db, row)


def send_password_reset(db: Session, user_id: int) -> None:
    """Supabase'den tek kullanımlık jeton alır, sıfırlama bağlantısını kullanıcının dilinde kendi şablonumuzla gönderir."""
    user = _user(db, user_id)
    try:
        token = supabase_admin.recovery_token(user.email)
    except supabase_admin.SupabaseAdminError as exc:
        raise AdminError(502, str(exc)) from exc
    en = user.email_lang == "en"
    url = f"{settings.frontend_url.rstrip('/')}/reset-password?token_hash={token}&type=recovery"
    subject = "Reset your Ulagg password" if en else "Ulagg şifreni sıfırla"
    part = {
        "heading": subject,
        "body": "Our team sent you a password reset link. Use the button below to set a new password." if en
        else "Ekibimiz sana bir şifre sıfırlama bağlantısı gönderdi. Yeni şifreni belirlemek için aşağıdaki düğmeyi kullan.",
        "button": "Set a new password" if en else "Yeni şifre belirle",
        "url": url,
        "note": "If you did not expect this email, you can ignore it; your password stays the same." if en
        else "Bu e-postayı beklemiyorsan yok sayabilirsin; şifren değişmez.",
    }
    markup, text = render("auth_action.html", title=subject, preheader=subject, parts=[part])
    if not send_email([user.email], subject, markup, text):
        raise AdminError(502, "E-posta gönderilemedi (e-posta servisi yapılandırılmamış ya da hata verdi).")


def set_role(db: Session, admin: User, user_id: int, role: str) -> None:
    user = _user(db, user_id)
    _guard_target(db, admin, user)
    row = access.ensure(db, user.id)
    if role == "admin" and row.status != "active":
        raise AdminError(409, "Askıdaki ya da engelli hesap yönetici yapılamaz.")
    row.role = role
    db.commit()


def set_status(db: Session, admin: User, user_id: int, status: str, reason: str) -> None:
    user = _user(db, user_id)
    _guard_target(db, admin, user)
    row = access.ensure(db, user.id)
    if status != "active" and row.role == "admin":
        raise AdminError(409, "Yönetici hesabı askıya alınamaz; önce rolünü kullanıcıya çevir.")
    # Giriş engeli Supabase'de: önce orada değiştirilir, başarısızsa yerel durum değişmez.
    if (status == "blocked") != (row.status == "blocked"):
        try:
            supabase_admin.set_banned(user.supabase_id, status == "blocked")
        except supabase_admin.SupabaseAdminError as exc:
            db.rollback()
            raise AdminError(502, str(exc)) from exc
    row.status = status
    row.status_reason = reason.strip() or None if status != "active" else None
    row.status_changed_at = dt.datetime.utcnow()
    db.commit()


def delete_user(db: Session, admin: User, user_id: int, confirm_email: str) -> str:
    from app.account import danger

    user = _user(db, user_id)
    _guard_target(db, admin, user)
    if access.is_admin(db, user):
        raise AdminError(409, "Yönetici hesabı silinemez; önce rolünü kullanıcıya çevir.")
    if confirm_email.strip().lower() != user.email.lower():
        raise AdminError(422, "Onay için kullanıcının e-postasını aynen yaz.")
    email = user.email
    try:
        danger.delete_account(db, user)
    except RuntimeError as exc:
        db.rollback()
        raise AdminError(502, str(exc)) from exc
    return email


def bulk(db: Session, admin: User, user_ids: list[int], action: str, amount: int | None, bucket: str, reason: str) -> list[BulkResultOut]:
    """Her kullanıcı ayrı işlenir; birinin hatası diğerlerini durdurmaz."""
    results = []
    for uid in dict.fromkeys(user_ids):
        try:
            if action == "credits":
                add_credits(db, admin, uid, amount or 0, bucket, reason)
            elif action == "suspend":
                set_status(db, admin, uid, "suspended", reason)
            elif action == "block":
                set_status(db, admin, uid, "blocked", reason)
            else:
                set_status(db, admin, uid, "active", "")
            results.append(BulkResultOut(user_id=uid, ok=True, error=None))
        except AdminError as exc:
            results.append(BulkResultOut(user_id=uid, ok=False, error=str(exc)))
    return results

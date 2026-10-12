"""Modül e-postaları: davet ve "kaydında bir şey oldu" bildirimleri. Gönderim hatası asıl işlemi bozmaz (sender loglar).

Bildirimler kayıt + olay türü başına 15 dakikada en fazla bir kez gider: tedarikçi on fiyatı art arda değiştirirse
satıcıya on e-posta yağmaz (ayrıntı kayıt akışında durur)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User, WorkspaceMember
from app.core.config import settings
from app.emails.renderer import render
from app.emails.sender import send_email
from app.modkit import ratelimit
from app.modkit.access import WRITE_ROLES
from app.modkit.models import ModuleEntity

NOTIFY_WINDOW = 15 * 60


def site_url(path: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}{path}"


def send_invite(to: str, en: bool, inviter: str, entity_name: str, workspace_name: str, url: str, days: int) -> bool:
    subject = (f"{inviter} invited you to Ulagg" if en else f"{inviter} seni Ulagg'a davet etti")
    heading = (f"Invitation: {entity_name}" if en else f"Davet: {entity_name}")
    rows = [
        ("From" if en else "Gönderen", inviter),
        ("Business" if en else "İşletme", workspace_name),
        ("Record" if en else "Kayıt", entity_name),
        ("Valid for" if en else "Geçerlilik", f"{days} days" if en else f"{days} gün"),
    ]
    footer = (
        f"Sign in or create an account with {to} to accept. Only this email address can use the invitation. "
        "If you were not expecting it, you can ignore this email."
        if en else
        f"Kabul etmek için {to} adresiyle giriş yap ya da hesap aç. Daveti yalnızca bu e-posta adresi kullanabilir. "
        "Beklemediğin bir davetse bu e-postayı yok sayabilirsin."
    )
    markup, text = render(
        "order_notification.html", title=subject, preheader=heading, heading=heading, rows=[r for r in rows if r[1]],
        url=url, button_label="Open invitation" if en else "Daveti aç", footer=footer,
    )
    return send_email([to], subject, markup, text)


def notify_members(db: Session, entity: ModuleEntity, kind: str, subject_tr: str, subject_en: str,
                   rows_tr: list[tuple[str, str]], rows_en: list[tuple[str, str]], path: str, exclude_user_id: int | None = None) -> None:
    """Kaydın çalışma alanındaki yazma yetkili üyelere kendi dillerinde e-posta (kısıtlı sıklıkta)."""
    if not ratelimit.check("notify", f"{entity.id}:{kind}", 1, NOTIFY_WINDOW):
        return
    users = db.scalars(
        select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == entity.workspace_id, WorkspaceMember.role.in_(WRITE_ROLES))
    ).all()
    for user in users:
        if user.id == exclude_user_id:
            continue
        en = user.email_lang == "en"
        subject = subject_en if en else subject_tr
        markup, text = render(
            "order_notification.html", title=subject, preheader=entity.name, heading=subject,
            rows=[r for r in (rows_en if en else rows_tr) if r[1]], url=site_url(path),
            button_label="Open" if en else "Aç",
            footer=(
                "You get this email because you are a member of this Ulagg workspace."
                if en else "Bu e-postayı bu Ulagg çalışma alanının üyesi olduğun için alıyorsun."
            ),
        )
        send_email([user.email], subject, markup, text)

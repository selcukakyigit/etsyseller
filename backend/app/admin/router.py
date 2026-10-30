import datetime as dt
from typing import Callable, Literal, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.admin import ai_models, announcement, audit, billing, broadcast, credits, exports, landing, messages, overview, revenue, shops, system, trends, user_actions, users
from app.admin.deps import AdminError, admin_only
from app.admin.schemas import (
    AdjustIn, AiModelIn, AiModelOut, AnnouncementIn, AnnouncementOut, AttachmentUrlOut, BroadcastIn, BroadcastOut, BroadcastPreviewOut, BroadcastSendIn, AuditPageOut, MessageReplyIn, OrdersPageOut, RevenueOut, ShopsPageOut, TrendsOut, BillingOverviewOut, BulkIn, LemonCheckOut, BulkResultOut,
    CatalogOut, CreditSettingsIn, CreditSettingsOut, DeleteUserIn, KeyIn, KeyTestIn, LandingSettingsIn, LandingSettingsOut,
    MessageOut, MessageUpdateIn, NoteIn,
    OnlineUserOut, OverviewOut, ProductIn, ProductOut, RoleIn, StatusIn, SystemOut, TaskIn, TestOut, UserCreditsIn,
    UserDetailOut, UsersPageOut, WorkspaceCreditsPageOut,
)
from app.auth.models import User
from app.core.db import get_db
from app.jobs import scheduler

# Yetki kontrolü router seviyesinde: buraya eklenen her uç nokta otomatik olarak yalnızca yöneticiye açıktır.
router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(admin_only)])
T = TypeVar("T")


def _run(fn: Callable[..., T], *args) -> T:
    """Servis hatasını (AdminError) HTTP hatasına çevirir."""
    try:
        return fn(*args)
    except AdminError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


# ---- Genel bakış, kullanıcılar, mesajlar, sistem


@router.get("/overview", response_model=OverviewOut)
def get_overview(db: Session = Depends(get_db)):
    return overview.get_overview(db)


@router.get("/users", response_model=UsersPageOut)
def list_users(
    q: str = Query("", max_length=200),
    status: Literal["", "active", "suspended", "blocked"] = "",
    joined_from: dt.date | None = None,
    joined_to: dt.date | None = None,
    sort: Literal["newest", "oldest", "last_seen"] = "newest",
    online: bool = False,
    limit: int = Query(50, ge=1, le=users.MAX_PAGE),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return users.list_users(
        db, q=q, status=status, joined_from=joined_from, joined_to=joined_to, sort=sort, limit=limit, offset=offset, online=online,
    )


@router.get("/online", response_model=list[OnlineUserOut])
def online_users(db: Session = Depends(get_db)):
    return users.online_users(db)


@router.get("/users/{user_id}", response_model=UserDetailOut)
def user_detail(user_id: int, db: Session = Depends(get_db)):
    return _run(users.get_detail, db, user_id)


@router.post("/users/bulk", response_model=list[BulkResultOut])
def bulk_users(payload: BulkIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    if payload.action == "credits" and not payload.amount:
        raise HTTPException(422, "Miktar 0 olamaz.")
    results = user_actions.bulk(db, admin, payload.user_ids, payload.action, payload.amount, payload.reason)
    for r in results:
        if r.ok:
            audit.record(db, admin, f"user.bulk.{payload.action}", f"user:{r.user_id}", f"{payload.amount or ''} {payload.reason}".strip())
    return results


@router.post("/users/{user_id}/credits")
def user_credits(user_id: int, payload: UserCreditsIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(user_actions.add_credits, db, admin, user_id, payload.amount, payload.note)
    audit.record(db, admin, "user.credits", f"user:{user_id}", f"{payload.amount:+d} {payload.note}".strip())
    return {"ok": True}


@router.post("/users/{user_id}/notes")
def user_add_note(user_id: int, payload: NoteIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(user_actions.add_note, db, admin, user_id, payload.text)
    audit.record(db, admin, "user.note", f"user:{user_id}")
    return {"ok": True}


@router.delete("/users/{user_id}/notes/{note_id}")
def user_delete_note(user_id: int, note_id: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(user_actions.delete_note, db, user_id, note_id)
    audit.record(db, admin, "user.note_delete", f"user:{user_id}")
    return {"ok": True}


@router.post("/users/{user_id}/password-reset")
def user_password_reset(user_id: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(user_actions.send_password_reset, db, user_id)
    audit.record(db, admin, "user.password_reset", f"user:{user_id}")
    return {"ok": True}


@router.put("/users/{user_id}/role")
def user_role(user_id: int, payload: RoleIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(user_actions.set_role, db, admin, user_id, payload.role)
    audit.record(db, admin, "user.role", f"user:{user_id}", payload.role)
    return {"ok": True}


@router.put("/users/{user_id}/status")
def user_status(user_id: int, payload: StatusIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(user_actions.set_status, db, admin, user_id, payload.status, payload.reason)
    audit.record(db, admin, "user.status", f"user:{user_id}", f"{payload.status} {payload.reason}".strip())
    return {"ok": True}


@router.delete("/users/{user_id}")
def user_delete(user_id: int, payload: DeleteUserIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    email = _run(user_actions.delete_user, db, admin, user_id, payload.confirm_email)
    audit.record(db, admin, "user.delete", f"user:{user_id}", email)
    return {"ok": True}


@router.get("/messages", response_model=list[MessageOut])
def list_messages(status: Literal["open", "all"] = "open", db: Session = Depends(get_db)):
    return messages.list_messages(db, only_open=status == "open")


@router.patch("/messages/{message_id}", response_model=MessageOut)
def update_message(message_id: int, payload: MessageUpdateIn, db: Session = Depends(get_db)):
    try:
        return messages.set_handled(db, message_id, payload.handled)
    except messages.NotFound as exc:
        raise HTTPException(404, "Mesaj bulunamadı") from exc


@router.get("/messages/attachments/{attachment_id}/url", response_model=AttachmentUrlOut)
def attachment_url(attachment_id: int, db: Session = Depends(get_db)):
    try:
        return messages.attachment_url(db, attachment_id)
    except messages.NotFound as exc:
        raise HTTPException(404, "Ek bulunamadı") from exc


@router.get("/system", response_model=SystemOut)
def get_system(db: Session = Depends(get_db)):
    return system.get_system(db)


@router.post("/system/jobs/{job_id}/run")
def run_job(job_id: str, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    if not scheduler.run_now(job_id):
        raise HTTPException(409, "İş başlatılamadı (bulunamadı ya da zaten sırada).")
    audit.record(db, admin, "job.run", job_id)
    return {"ok": True}


@router.get("/audit", response_model=AuditPageOut)
def get_audit(
    q: str = Query("", max_length=200), action: str = Query("", max_length=60), admin: str = Query("", max_length=255),
    date_from: dt.date | None = None, date_to: dt.date | None = None,
    limit: int = Query(50, ge=1, le=audit.MAX_PAGE), offset: int = Query(0, ge=0), db: Session = Depends(get_db),
):
    return audit.search(db, q=q, action=action, admin=admin, date_from=date_from, date_to=date_to, limit=limit, offset=offset)


@router.get("/overview/trends", response_model=TrendsOut)
def overview_trends(days: int = Query(30, ge=7, le=trends.MAX_DAYS), db: Session = Depends(get_db)):
    return trends.trends(db, days)


@router.get("/shops", response_model=ShopsPageOut)
def list_shops(
    q: str = Query("", max_length=200), status: Literal["", "connected", "revoked", "demo", "stale", "never"] = "",
    limit: int = Query(50, ge=1, le=shops.MAX_PAGE), offset: int = Query(0, ge=0), db: Session = Depends(get_db),
):
    return shops.list_shops(db, q=q, status=status, limit=limit, offset=offset)


@router.post("/messages/{message_id}/reply", response_model=MessageOut)
def reply_message(message_id: int, payload: MessageReplyIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    try:
        out = _run(messages.reply, db, message_id, payload.body)
    except messages.NotFound as exc:
        raise HTTPException(404, "Mesaj bulunamadı") from exc
    audit.record(db, admin, "message.reply", f"message:{message_id}", out.email)
    return out


@router.get("/announcements", response_model=list[AnnouncementOut])
def list_announcements(db: Session = Depends(get_db)):
    return announcement.list_all(db)


@router.post("/announcements", response_model=AnnouncementOut)
def create_announcement(payload: AnnouncementIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(announcement.create, db, payload)
    audit.record(db, admin, "announcement.create", f"announcement:{out.id}", "on" if out.active else "off")
    return out


@router.put("/announcements/{announcement_id}", response_model=AnnouncementOut)
def update_announcement(announcement_id: int, payload: AnnouncementIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(announcement.update, db, announcement_id, payload)
    audit.record(db, admin, "announcement.update", f"announcement:{announcement_id}", "on" if out.active else "off")
    return out


@router.delete("/announcements/{announcement_id}")
def delete_announcement(announcement_id: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(announcement.delete, db, announcement_id)
    audit.record(db, admin, "announcement.delete", f"announcement:{announcement_id}")
    return {"ok": True}


@router.get("/broadcasts", response_model=list[BroadcastOut])
def list_broadcasts(db: Session = Depends(get_db)):
    return broadcast.list_all(db)


@router.get("/broadcasts/preview", response_model=BroadcastPreviewOut)
def broadcast_preview(db: Session = Depends(get_db)):
    return broadcast.preview(db)


@router.post("/broadcasts/test")
def broadcast_test(payload: BroadcastIn, admin: User = Depends(admin_only)):
    _run(broadcast.send_test, admin, payload)
    return {"ok": True}


@router.post("/broadcasts", response_model=BroadcastOut)
def create_broadcast(payload: BroadcastIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    return broadcast.create(db, admin, payload)


@router.put("/broadcasts/{broadcast_id}", response_model=BroadcastOut)
def update_broadcast(broadcast_id: int, payload: BroadcastIn, db: Session = Depends(get_db)):
    return _run(broadcast.update, db, broadcast_id, payload)


@router.delete("/broadcasts/{broadcast_id}")
def delete_broadcast(broadcast_id: int, db: Session = Depends(get_db)):
    _run(broadcast.delete, db, broadcast_id)
    return {"ok": True}


@router.post("/broadcasts/{broadcast_id}/send", response_model=BroadcastOut)
def send_broadcast(broadcast_id: int, payload: BroadcastSendIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(broadcast.start, db, broadcast_id, payload.confirm_count)
    audit.record(db, admin, "broadcast.send", f"broadcast:{broadcast_id}", f"{out.total} recipients: {out.subject_en}")
    return out


def _csv(name: str, content: str) -> Response:
    return Response(content, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}-{dt.date.today().isoformat()}.csv"'})


@router.get("/export/{kind}")
def export_csv(
    kind: Literal["users", "ledger", "orders", "audit"],
    q: str = Query("", max_length=200), status: Literal["", "active", "suspended", "blocked"] = "",
    joined_from: dt.date | None = None, joined_to: dt.date | None = None,
    days: int = Query(30, ge=1, le=366), workspace_id: int | None = None,
    action: str = Query("", max_length=60), admin_email: str = Query("", max_length=255),
    date_from: dt.date | None = None, date_to: dt.date | None = None,
    admin: User = Depends(admin_only), db: Session = Depends(get_db),
):
    """Ekrandaki filtrelerle aynı süzgeçle CSV. Kişisel veri içerdiği için indirme işlem kaydına yazılır."""
    if kind == "users":
        body = exports.users_csv(db, q, status, joined_from, joined_to)
    elif kind == "ledger":
        body = exports.ledger_csv(db, days, workspace_id)
    elif kind == "orders":
        body = exports.orders_csv(db, days)
    else:
        body = exports.audit_csv(db, q=q, action=action, admin=admin_email, date_from=date_from, date_to=date_to)
    audit.record(db, admin, "export.csv", kind)
    return _csv(kind, body)


# ---- Modeller ve anahtarlar


@router.get("/catalog", response_model=CatalogOut)
def get_catalog(db: Session = Depends(get_db)):
    return ai_models.get_catalog(db)


@router.post("/models", response_model=AiModelOut)
def create_model(payload: AiModelIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(ai_models.create_model, db, payload)
    audit.record(db, admin, "model.create", f"{out.provider}/{out.model_id}")
    return out


@router.put("/models/{model_id}", response_model=AiModelOut)
def update_model(model_id: int, payload: AiModelIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(ai_models.update_model, db, model_id, payload)
    audit.record(db, admin, "model.update", f"{out.provider}/{out.model_id}", payload.model_dump_json())
    return out


@router.delete("/models/{model_id}")
def delete_model(model_id: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    row = _run(ai_models.delete_model, db, model_id)
    audit.record(db, admin, "model.delete", f"{row.provider}/{row.model_id}")
    return {"ok": True}


@router.put("/tasks/{task}")
def assign_task(task: str, payload: TaskIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(ai_models.assign_task, db, task, payload.model_id, payload.variant)
    audit.record(db, admin, "task.assign", task, f"model_id={payload.model_id} variant={payload.variant or '-'}")
    return {"ok": True}


@router.put("/keys/{provider}")
def set_key(provider: str, payload: KeyIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(ai_models.set_key, db, provider, payload.api_key)
    audit.record(db, admin, "key.set", provider)  # anahtarın kendisi kayda yazılmaz
    return {"ok": True}


@router.delete("/keys/{provider}")
def clear_key(provider: str, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(ai_models.clear_key, db, provider)
    audit.record(db, admin, "key.clear", provider)
    return {"ok": True}


@router.post("/keys/{provider}/test", response_model=TestOut)
def test_key(provider: str, payload: KeyTestIn):
    return ai_models.test_key(provider, payload.api_key)


@router.post("/etsy/test", response_model=TestOut)
def test_etsy():
    return ai_models.test_etsy()


# ---- Krediler


@router.get("/credits/settings", response_model=CreditSettingsOut)
def credit_settings():
    return credits.get_settings()


@router.put("/credits/settings", response_model=CreditSettingsOut)
def update_credit_settings(payload: CreditSettingsIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = credits.update_settings(db, payload)
    audit.record(db, admin, "credits.settings", "", payload.model_dump_json(exclude_none=True))
    return out


@router.get("/credits/workspaces", response_model=WorkspaceCreditsPageOut)
def credit_workspaces(
    q: str = Query("", max_length=200),
    limit: int = Query(50, ge=1, le=credits.MAX_PAGE),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return credits.list_workspaces(db, q=q, limit=limit, offset=offset)


@router.post("/credits/workspaces/{workspace_id}/adjust")
def adjust_credits(workspace_id: int, payload: AdjustIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(credits.adjust, db, workspace_id, payload.amount, payload.note, admin.id)
    audit.record(db, admin, "credits.adjust", f"workspace:{workspace_id}", f"{payload.amount:+d} {payload.note}")
    return {"ok": True}


@router.get("/credits/breakdown")
def credits_breakdown(workspace_id: int | None = None, days: int = Query(30, ge=1, le=366), admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    return _run(credits.breakdown, db, workspace_id, days)


# ---- Landing (tanıtım sitesi)


@router.get("/landing", response_model=LandingSettingsOut)
def landing_settings():
    return landing.get_settings()


@router.put("/landing", response_model=LandingSettingsOut)
def update_landing_settings(payload: LandingSettingsIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(landing.update_settings, db, payload)
    audit.record(db, admin, "landing.settings", "", payload.model_dump_json())
    return out


# ---- Satış


@router.get("/billing", response_model=BillingOverviewOut)
def billing_overview(db: Session = Depends(get_db)):
    return billing.overview(db)


@router.get("/billing/revenue", response_model=RevenueOut)
def billing_revenue(days: int = Query(30, ge=1, le=revenue.MAX_DAYS), db: Session = Depends(get_db)):
    return revenue.revenue(db, days)


@router.get("/billing/orders", response_model=OrdersPageOut)
def billing_orders(
    days: int = Query(30, ge=1, le=revenue.MAX_DAYS), limit: int = Query(50, ge=1, le=revenue.MAX_PAGE), offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return revenue.orders(db, days, limit, offset)


@router.get("/billing/lemon-check", response_model=LemonCheckOut)
def lemon_check(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    return billing.lemon_check(db)


@router.post("/billing/products", response_model=ProductOut)
def create_product(payload: ProductIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(billing.create_product, db, payload)
    audit.record(db, admin, "product.create", f"product:{out.variant_id}", payload.model_dump_json())
    return out


@router.put("/billing/products/{product_id}", response_model=ProductOut)
def update_product(product_id: int, payload: ProductIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(billing.update_product, db, product_id, payload)
    audit.record(db, admin, "product.update", f"product:{out.variant_id}", payload.model_dump_json())
    return out


@router.delete("/billing/products/{product_id}")
def delete_product(product_id: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    row = _run(billing.delete_product, db, product_id)
    audit.record(db, admin, "product.delete", f"product:{row.variant_id}")
    return {"ok": True}

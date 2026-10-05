import datetime as dt
from typing import Callable, Literal, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.admin import ai_models, audit, billing, credits, messages, overview, system, user_actions, users
from app.admin.deps import AdminError, admin_only
from app.admin.schemas import (
    AdjustIn, AiModelIn, AiModelOut, AssignPlanIn, AttachmentUrlOut, AuditOut, BillingOverviewOut, BulkIn, BulkResultOut,
    CatalogOut, CreditSettingsIn, CreditSettingsOut, DeleteUserIn, KeyIn, KeyTestIn, MessageOut, MessageUpdateIn, NoteIn,
    OnlineUserOut, OverviewOut, ProductIn, ProductOut, RoleIn, StatusIn, SystemOut, TaskIn, TestOut, UsageReportOut, UserCreditsIn,
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
    plan: str = Query("", max_length=20, pattern=r"^(|free|paid|[0-9]+)$"),
    joined_from: dt.date | None = None,
    joined_to: dt.date | None = None,
    sort: Literal["newest", "oldest", "last_seen"] = "newest",
    online: bool = False,
    limit: int = Query(50, ge=1, le=users.MAX_PAGE),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return users.list_users(
        db, q=q, status=status, plan=plan, joined_from=joined_from, joined_to=joined_to, sort=sort, limit=limit, offset=offset, online=online,
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
    results = user_actions.bulk(db, admin, payload.user_ids, payload.action, payload.amount, payload.bucket, payload.reason)
    for r in results:
        if r.ok:
            audit.record(db, admin, f"user.bulk.{payload.action}", f"user:{r.user_id}", f"{payload.amount or ''} {payload.reason}".strip())
    return results


@router.post("/users/{user_id}/credits")
def user_credits(user_id: int, payload: UserCreditsIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(user_actions.add_credits, db, admin, user_id, payload.amount, payload.bucket, payload.note)
    audit.record(db, admin, "user.credits", f"user:{user_id}", f"{payload.amount:+d} {payload.bucket} {payload.note}".strip())
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


@router.post("/users/{user_id}/plan")
def user_assign_plan(user_id: int, payload: AssignPlanIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(user_actions.assign_plan, db, user_id, payload.product_id, payload.months)
    audit.record(db, admin, "user.plan", f"user:{user_id}", f"product={payload.product_id} months={payload.months}")
    return {"ok": True}


@router.delete("/users/{user_id}/plan")
def user_end_plan(user_id: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    _run(user_actions.end_plan, db, user_id)
    audit.record(db, admin, "user.plan_end", f"user:{user_id}")
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


@router.get("/audit", response_model=list[AuditOut])
def get_audit(db: Session = Depends(get_db)):
    return audit.recent(db)


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
    _run(ai_models.assign_task, db, task, payload.model_id)
    audit.record(db, admin, "task.assign", task, f"model_id={payload.model_id}")
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
    _run(credits.adjust, db, workspace_id, payload.amount, payload.bucket, payload.note, admin.id)
    audit.record(db, admin, "credits.adjust", f"workspace:{workspace_id}", f"{payload.amount:+d} {payload.bucket} {payload.note}")
    return {"ok": True}


@router.get("/credits/usage", response_model=UsageReportOut)
def credit_usage(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    return credits.usage_report(db, days)


# ---- Satış


@router.get("/billing", response_model=BillingOverviewOut)
def billing_overview(db: Session = Depends(get_db)):
    return billing.overview(db)


@router.post("/billing/products", response_model=ProductOut)
def create_product(payload: ProductIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(billing.create_product, db, payload)
    audit.record(db, admin, "product.create", f"{out.kind}:{out.variant_id}", payload.model_dump_json())
    return out


@router.put("/billing/products/{product_id}", response_model=ProductOut)
def update_product(product_id: int, payload: ProductIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    out = _run(billing.update_product, db, product_id, payload)
    audit.record(db, admin, "product.update", f"{out.kind}:{out.variant_id}", payload.model_dump_json())
    return out


@router.delete("/billing/products/{product_id}")
def delete_product(product_id: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    row = _run(billing.delete_product, db, product_id)
    audit.record(db, admin, "product.delete", f"{row.kind}:{row.variant_id}")
    return {"ok": True}

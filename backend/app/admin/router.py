from typing import Callable, Literal, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.admin import ai_models, audit, billing, credits, messages, overview, system, users
from app.admin.deps import AdminError, admin_only
from app.admin.schemas import (
    AdjustIn, AiModelIn, AiModelOut, AttachmentUrlOut, AuditOut, BillingOverviewOut, CatalogOut, CreditSettingsIn,
    CreditSettingsOut, KeyIn, KeyTestIn, MessageOut, MessageUpdateIn, OverviewOut, ProductIn, ProductOut, SystemOut, TaskIn,
    TestOut, UsageReportOut, UsersPageOut, WorkspaceCreditsPageOut,
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
    limit: int = Query(50, ge=1, le=users.MAX_PAGE),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return users.list_users(db, q=q, limit=limit, offset=offset)


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

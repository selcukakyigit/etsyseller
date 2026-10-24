"""Yönetim > Araştırma uç noktaları. Yetki router seviyesinde (yalnızca yönetici); ham sayısal tablolar yalnızca buradan çıkar."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.admin import audit
from app.admin.deps import admin_only
from app.auth.models import User
from app.core.db import get_db
from app.core.i18n import tr
from app.research import admin, credentials, jobs, policy, service
from app.research.models import ResearchJob
from app.research.providers import DEFAULT_PROVIDER, get_provider
from app.research.records import ProviderError

router = APIRouter(prefix="/api/admin/research", tags=["admin-research"], dependencies=[Depends(admin_only)])


class RefreshIn(BaseModel):
    terms: list[str] = Field(min_length=1, max_length=1000)
    market: str | None = None


class CredentialsIn(BaseModel):
    login: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class SettingsIn(BaseModel):
    values: dict


@router.get("/overview", response_model=admin.OverviewOut)
def overview(db: Session = Depends(get_db)):
    return admin.overview(db)


@router.get("/keywords", response_model=admin.KeywordsPageOut)
def keywords(
    q: str = "", state: str = Query("", pattern="^(|fresh|stale|missing)$"), market: str | None = None, language: str | None = None,
    sort: str = Query("new", pattern="^(new|volume|cpc|difficulty|measured)$"), source: str = Query("", max_length=30), etsy: bool = False,
    page: int = Query(1, ge=1), db: Session = Depends(get_db),
):
    return admin.keywords(
        db, q=q, state=state, market=market or policy.get("research_default_market"), language=language or policy.get("research_default_language"), page=page,
        sort=sort, source=source, etsy=etsy,
    )


@router.get("/keywords/{keyword_id}", response_model=admin.KeywordDetailOut)
def keyword_detail(keyword_id: int, market: str | None = None, db: Session = Depends(get_db)):
    out = admin.keyword_detail(db, keyword_id, market or policy.get("research_default_market"))
    if out is None:
        raise HTTPException(404, tr("Kelime bulunamadı", "Keyword not found"))
    return out


@router.post("/keywords/refresh")
def refresh(payload: RefreshIn, admin_user: User = Depends(admin_only), db: Session = Depends(get_db)):
    result = service.request_refresh(db, payload.terms, market=payload.market)
    audit.record(db, admin_user, "research.refresh", f"{len(payload.terms)} terms", result.refused or "")
    return {"pending": result.pending, "refused": result.refused}


@router.get("/jobs", response_model=admin.JobsPageOut)
def list_jobs(status: str = Query("", pattern="^(|queued|running|done|failed|dead|cancelled)$"), page: int = Query(1, ge=1), db: Session = Depends(get_db)):
    return admin.jobs_page(db, status=status, page=page)


def _job(db: Session, job_id: int) -> ResearchJob:
    job = db.get(ResearchJob, job_id)
    if job is None:
        raise HTTPException(404, tr("İş bulunamadı", "Job not found"))
    return job


@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: int, admin_user: User = Depends(admin_only), db: Session = Depends(get_db)):
    ok = jobs.retry(db, _job(db, job_id))
    db.commit()
    audit.record(db, admin_user, "research.job_retry", str(job_id), "ok" if ok else "refused")
    return {"ok": ok}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: int, admin_user: User = Depends(admin_only), db: Session = Depends(get_db)):
    ok = jobs.cancel(_job(db, job_id))
    db.commit()
    audit.record(db, admin_user, "research.job_cancel", str(job_id), "ok" if ok else "refused")
    return {"ok": ok}


@router.get("/calls", response_model=list[admin.CallOut])
def calls(db: Session = Depends(get_db)):
    return admin.recent_calls(db)


@router.get("/cost", response_model=admin.CostOut)
def cost(db: Session = Depends(get_db)):
    return admin.cost_report(db)


@router.get("/settings")
def get_settings():
    return policy.snapshot()


@router.put("/settings")
def put_settings(payload: SettingsIn, admin_user: User = Depends(admin_only), db: Session = Depends(get_db)):
    try:
        out = admin.save_settings(db, payload.values)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    audit.record(db, admin_user, "research.settings", ",".join(sorted(payload.values)), "")
    return out


@router.put("/credentials")
def put_credentials(payload: CredentialsIn, admin_user: User = Depends(admin_only), db: Session = Depends(get_db)):
    credentials.save(db, DEFAULT_PROVIDER, payload.login.strip(), payload.password)
    audit.record(db, admin_user, "research.credentials", DEFAULT_PROVIDER, "saved")  # değer asla kaydedilmez
    return {"credentials": credentials.source(db, DEFAULT_PROVIDER)}


@router.delete("/credentials")
def delete_credentials(admin_user: User = Depends(admin_only), db: Session = Depends(get_db)):
    credentials.clear(db, DEFAULT_PROVIDER)
    audit.record(db, admin_user, "research.credentials", DEFAULT_PROVIDER, "removed")
    return {"credentials": credentials.source(db, DEFAULT_PROVIDER)}


@router.get("/account")
def account(db: Session = Depends(get_db)):
    """Sağlayıcı bağlantısını ve bakiyeyi doğrular (ücretsiz çağrı)."""
    creds = credentials.get(db, DEFAULT_PROVIDER)
    if creds is None:
        return {"ok": False, "error": tr("Kimlik bilgisi girilmemiş", "No credentials set")}
    try:
        return {"ok": True, **get_provider().account(creds)}
    except ProviderError as exc:
        return {"ok": False, "error": str(exc)}

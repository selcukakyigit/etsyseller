"""Keşfet uç noktaları (kullanıcıya açık). Her uç nokta `get_owned_shop` ile mağaza sahipliğini doğrular; kaydedilenler çalışma alanına bağlıdır.
Yanıtlarda ham arama sayısı/CPC yoktur (bkz. discover.py)."""
from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.db import get_db
from app.core.deps import get_current_user
from app.jobs.research import run_queue
from app.research import discover
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/discover", tags=["discover"])


class SavedIn(BaseModel):
    terms: list[str] = Field(min_length=1, max_length=100)
    collection: str = Field(default="", max_length=discover.MAX_COLLECTION_CHARS)


@router.get("/search")
def search(
    background: BackgroundTasks, q: str = Query(min_length=1, max_length=120), mode: str = Query("all", pattern="^(all|questions)$"), refresh: bool = False,
    shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db),
):
    result = discover.search(db, shop, q, mode, refresh)
    if result.status == "pending" or result.stale:
        background.add_task(run_queue)  # sağlayıcıya istek yanıttan SONRA arka planda gider (dakikalık iş de aynı kuyruğu işler; kilit çift çalışmayı önler)
    return result.as_dict()


@router.get("/saved")
def saved(collection: str | None = None, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    view = discover.saved(db, shop, collection)
    return {"collections": view.collections, "collection": view.collection, "total": view.total, "items": [vars(i) for i in view.items]}


@router.post("/saved")
def save(payload: SavedIn, background: BackgroundTasks, shop: Shop = Depends(get_owned_shop), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    added = discover.save(db, shop, user.id, payload.terms, payload.collection)
    if added:
        background.add_task(run_queue)
    return {"added": added}


class EtsyResultsIn(BaseModel):
    terms: list[str] = Field(min_length=1, max_length=discover.ETSY_RESULTS_MAX)


@router.post("/etsy-results")
def etsy_results(payload: EtsyResultsIn, shop: Shop = Depends(get_owned_shop)):
    """Kelimelerin Etsy'deki aktif ilan sayısı (rakip sayısı). `limited`: mağazanın ölçüm hakkı geçici olarak doldu."""
    counts = discover.etsy_results(shop, payload.terms)
    return {"counts": counts or {}, "limited": counts is None}


@router.post("/saved/remove")
def unsave(payload: SavedIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return {"removed": discover.unsave(db, shop, payload.terms, payload.collection)}

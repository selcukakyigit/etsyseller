"""Kullanıcının Plan ve krediler ekranı: bakiye, abonelik, satın alınabilir ürünler, ödeme sayfası ve kullanım geçmişi.
Bakiye kişisel (ilk) çalışma alanına aittir."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.workspaces import primary_workspace
from app.billing import credits, lemon, service, settings as credit_settings
from app.billing.models import BillingProduct, CreditLedger
from app.core.config import settings
from app.core.dates import iso
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.i18n import get_lang

router = APIRouter(prefix="/api/billing", tags=["billing"])
HISTORY_ROWS = 50


class CheckoutIn(BaseModel):
    product_id: int


def _product_out(p: BillingProduct) -> dict:
    return {
        "id": p.id, "kind": p.kind, "name": p.name_en if get_lang() == "en" else p.name_tr, "credits": p.credits,
        "price_cents": p.price_cents, "currency": p.currency, "interval": p.interval,
    }


@router.get("/summary")
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ws = primary_workspace(db, user)
    try:
        plan, purchased = credits.balance(db, ws.id)
        sub = service.live_subscription(db, ws.id)
        products = db.scalars(select(BillingProduct).where(BillingProduct.active.is_(True)).order_by(BillingProduct.sort, BillingProduct.id)).all()
    except SQLAlchemyError:  # ödeme tabloları henüz yoksa ekran "yakında" gösterir, hata vermez
        db.rollback()
        return {"enabled": False, "balance": {"plan": 0, "purchased": 0}, "subscription": None, "products": [], "can_buy": False}
    return {
        "enabled": credit_settings.enabled(),
        "balance": {"plan": plan, "purchased": purchased},
        "subscription": None if sub is None else {
            "status": sub.status, "renews_at": iso(sub.renews_at), "ends_at": iso(sub.ends_at), "portal_url": sub.portal_url,
            "product": _product_out(db.get(BillingProduct, sub.product_id)) if sub.product_id else None,
        },
        "products": [_product_out(p) for p in products],
        "can_buy": lemon.configured(),
    }


@router.get("/history")
def history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ws = primary_workspace(db, user)
    try:
        rows = db.scalars(select(CreditLedger).where(CreditLedger.workspace_id == ws.id).order_by(CreditLedger.id.desc()).limit(HISTORY_ROWS)).all()
    except SQLAlchemyError:
        db.rollback()
        return []
    return [
        {"id": r.id, "kind": r.kind, "task": r.task, "credits": r.credits, "delta": r.delta, "created_at": iso(r.created_at)}
        for r in rows
    ]


@router.post("/checkout")
def checkout(body: CheckoutIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    product = db.get(BillingProduct, body.product_id)
    if product is None or not product.active:
        raise HTTPException(404, "Ürün bulunamadı")
    ws = primary_workspace(db, user)
    if product.kind == "plan" and service.live_subscription(db, ws.id) is not None:
        raise HTTPException(409, "Zaten bir aboneliğin var; planını abonelik yönetiminden değiştirebilirsin.")
    try:
        url = lemon.create_checkout(
            product.variant_id, user.email, {"workspace_id": ws.id, "user_id": user.id},
            f"{settings.frontend_url}/settings/billing?checkout=done",
        )
    except lemon.LemonError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"url": url}

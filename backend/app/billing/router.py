"""Kullanıcının krediler ekranı: bakiye, satın alınabilir kredi paketleri, ödeme sayfası, harcama dökümü ve kullanım geçmişi.
Bakiye kişisel (ilk) çalışma alanına aittir."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.workspaces import primary_workspace
from app.billing import credits, custom, lemon, settings as credit_settings, usage
from app.billing.models import BillingProduct, CreditLedger
from app.core.config import settings
from app.core.dates import iso
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.i18n import get_lang

router = APIRouter(prefix="/api/billing", tags=["billing"])
HISTORY_ROWS = 50


class CheckoutIn(BaseModel):
    product_id: int | None = None
    credits: int | None = None  # özel miktar; product_id yerine verilir, fiyatı sunucu hesaplar
    # Ödeme öncesi onay: şartlar + dijital hizmetin hemen başlaması (cayma hakkının sona ermesi). Sürüm, ispat için ödeme kaydına yazılır.
    accept_terms: bool = False
    terms_version: str = Field("", max_length=20)


def _product_out(p: BillingProduct, products: list[BillingProduct]) -> dict:
    list_price, pct = custom.pack_discount(products, p)
    return {
        "id": p.id, "name": p.name_en if get_lang() == "en" else p.name_tr, "credits": p.credits,
        "price_cents": p.price_cents, "currency": p.currency, "list_price_cents": list_price, "discount_pct": pct,
    }


@router.get("/summary")
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ws = primary_workspace(db, user)
    try:
        balance = credits.balance(db, ws.id)
        products = db.scalars(select(BillingProduct).where(BillingProduct.active.is_(True)).order_by(BillingProduct.sort, BillingProduct.id)).all()
    except SQLAlchemyError:  # ödeme tabloları henüz yoksa ekran "yakında" gösterir, hata vermez
        db.rollback()
        return {"enabled": False, "balance": 0, "products": [], "can_buy": False, "custom": None}
    sorted_products = custom.active_products(db)
    return {
        "enabled": credit_settings.enabled(), "balance": balance, "products": [_product_out(p, sorted_products) for p in products], "can_buy": lemon.configured(),
        "custom": custom.info(db) if sorted_products and settings.lemonsqueezy_custom_variant_id else None,
    }


@router.get("/quote")
def quote(credits: int = Query(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Özel kredi miktarının fiyatı (canlı gösterim için). Ödemede aynı hesap sunucuda yeniden yapılır."""
    try:
        return custom.quote(db, credits)
    except custom.CustomError as exc:
        raise HTTPException(422, "Kredi miktarı geçersiz" if str(exc) == "range" else "Ürün bulunamadı") from exc


@router.get("/usage")
def usage_breakdown(days: int = Query(30, ge=1, le=usage.MAX_DAYS), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Bu çalışma alanının harcaması: kategoriye (metin / görsel / video / sistem), modele ve güne göre. Sağlayıcı maliyeti dönmez."""
    ws = primary_workspace(db, user)
    try:
        return usage.breakdown(db, ws.id, days)
    except SQLAlchemyError:
        db.rollback()
        return {"days": days, "calls": 0, "total": 0, "by_category": dict.fromkeys(usage.CATEGORIES, 0), "daily": [], "by_model": []}


@router.get("/history")
def history(purchases: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Kredi hareketleri. `purchases=true`: yalnızca satın almalar ve iadeler (kullanım kayıtları arasında kaybolmasın)."""
    ws = primary_workspace(db, user)
    query = select(CreditLedger).where(CreditLedger.workspace_id == ws.id)
    if purchases:
        query = query.where(CreditLedger.kind.in_(("purchase", "refund")))
    try:
        rows = db.scalars(query.order_by(CreditLedger.id.desc()).limit(HISTORY_ROWS)).all()
    except SQLAlchemyError:
        db.rollback()
        return []
    return [
        {
            "id": r.id, "kind": r.kind, "task": r.task, "credits": r.credits, "platform_credits": r.platform_credits, "delta": r.delta, "model": r.model,
            "note": r.note if purchases else "", "created_at": iso(r.created_at),
        }
        for r in rows
    ]


@router.post("/checkout")
def checkout(body: CheckoutIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.accept_terms:
        raise HTTPException(400, "Ödemeden önce koşulları ve iade politikasını onaylamalısınız")
    extra: dict[str, str] = {}
    price: int | None = None
    if body.credits is not None:
        # Özel miktar: fiyat burada hesaplanır; ödeme sağlayıcısındaki ayrı "özel miktar" ürününün varyantı, bu tutarla açılır.
        try:
            q = custom.quote(db, body.credits)
        except custom.CustomError as exc:
            raise HTTPException(422, "Kredi miktarı geçersiz" if str(exc) == "range" else "Ürün bulunamadı") from exc
        if not settings.lemonsqueezy_custom_variant_id:
            raise HTTPException(404, "Ürün bulunamadı")
        variant = settings.lemonsqueezy_custom_variant_id
        price = q["price_cents"]
        extra = {"custom_credits": q["credits"], "custom_price_cents": price}
    else:
        product = db.get(BillingProduct, body.product_id) if body.product_id is not None else None
        if product is None or not product.active:
            raise HTTPException(404, "Ürün bulunamadı")
        variant = product.variant_id
    ws = primary_workspace(db, user)
    try:
        url = lemon.create_checkout(
            variant, user.email,
            {"workspace_id": ws.id, "user_id": user.id, "terms_version": body.terms_version, "immediate_service_ack": "1", **extra},
            f"{settings.frontend_url}/settings/billing?checkout=done",
            custom_price=price,
        )
    except lemon.LemonError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"url": url}

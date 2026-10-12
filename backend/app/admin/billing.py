"""Yönetim > Satış: Lemon Squeezy yapılandırma durumu, satılan kredi paketleri ve son webhook olayları."""
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.schemas import BillingEventOut, BillingOverviewOut, ProductIn, ProductOut
from app.billing import lemon
from app.billing.models import BillingEvent, BillingProduct
from app.core.config import settings
from app.core.dates import iso

MAX_ROWS = 100


def _product_out(p: BillingProduct) -> ProductOut:
    return ProductOut(
        id=p.id, name_tr=p.name_tr, name_en=p.name_en, variant_id=p.variant_id, credits=p.credits,
        price_cents=p.price_cents, currency=p.currency, active=p.active, sort=p.sort,
    )


def overview(db: Session) -> BillingOverviewOut:
    products = db.scalars(select(BillingProduct).order_by(BillingProduct.sort, BillingProduct.id)).all()
    events = db.scalars(select(BillingEvent).order_by(BillingEvent.id.desc()).limit(MAX_ROWS)).all()
    return BillingOverviewOut(
        lemon_configured=lemon.configured(),
        webhook_configured=bool(settings.lemonsqueezy_webhook_secret),
        products=[_product_out(p) for p in products],
        events=[
            BillingEventOut(id=e.id, event_name=e.event_name, lemon_id=e.lemon_id, workspace_id=e.workspace_id, ok=e.ok, error=e.error, created_at=iso(e.created_at))
            for e in events
        ],
    )


def _apply(row: BillingProduct, data: ProductIn) -> None:
    row.name_tr, row.name_en = data.name_tr.strip(), data.name_en.strip()
    row.variant_id, row.credits, row.price_cents, row.currency = data.variant_id, data.credits, data.price_cents, data.currency
    row.active, row.sort = data.active, data.sort


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AdminError(409, "Bu Lemon varyant numarası başka bir üründe kullanılıyor.") from exc


def create_product(db: Session, data: ProductIn) -> ProductOut:
    row = BillingProduct()
    _apply(row, data)
    db.add(row)
    _commit(db)
    return _product_out(row)


def update_product(db: Session, product_id: int, data: ProductIn) -> ProductOut:
    row = db.get(BillingProduct, product_id)
    if row is None:
        raise AdminError(404, "Ürün bulunamadı")
    _apply(row, data)
    _commit(db)
    return _product_out(row)


def delete_product(db: Session, product_id: int) -> BillingProduct:
    """Paketi siler; satın alma geçmişi defterde durur."""
    row = db.get(BillingProduct, product_id)
    if row is None:
        raise AdminError(404, "Ürün bulunamadı")
    db.delete(row)
    db.commit()
    return row

"""Kargo/gümrük faturası yükleme uç noktaları — service.py/router.py'den bilinçli olarak ayrı tutulur
(zaten büyük olan o dosyalara dokunmadan, kendi köşesinde büyür)."""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.finance import invoices, service
from app.shops.deps import get_owned_shop, require_ai_enabled
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/finance/invoices", tags=["finance-invoices"])

MAX_BYTES = 15 * 1024 * 1024


class MatchItem(BaseModel):
    listing_id: int | None
    variant_key: str
    title: str
    qty: int


class MatchOut(BaseModel):
    receipt_id: int
    canceled: bool = False
    buyer: str
    country: str
    date: str
    score: float
    reason: str
    items: list[MatchItem]


class CandidateOut(BaseModel):
    vendor: str
    invoice_number: str
    invoice_date: str
    kind: str
    description: str
    tracking_no: str
    ship_date: str | None
    recipient: str
    recipient_country: str
    weight_kg: float | None
    original_amount: float
    check_note: str = ""
    original_currency: str
    amount: float
    fx_rate: float
    fx_source: str
    matches: list[MatchOut]
    already_saved: bool
    source_filename: str


class ConfirmIn(BaseModel):
    receipt_id: int
    # Aday, /parse'ın döndüğü CandidateOut'un aynısı — sunucu tarafında ayrıca saklanmadığı için istemci geri gönderir.
    candidate: dict


@router.post("/parse", response_model=list[CandidateOut], dependencies=[Depends(require_ai_enabled)])
async def parse_invoice(
    shop: Shop = Depends(get_owned_shop),
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
):
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(413, "Dosya çok büyük (en fazla 15MB)")
    report_ccy = service._fx_tables(db, shop)["R"]
    try:
        return invoices.parse_file(db, shop, content, file.filename or "fatura", file.content_type or "", report_ccy)
    except invoices.InvoiceError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/confirm")
def confirm_invoice(payload: ConfirmIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        rows = invoices.confirm(db, shop, payload.receipt_id, payload.candidate)
    except invoices.InvoiceError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ids": [r.id for r in rows]}


@router.get("")
def list_invoices(
    q: str = "", kind: str = "", inv_start: str = "", inv_end: str = "", order_start: str = "", order_end: str = "",
    sort: str = "inv_date", page: int = Query(0, ge=0), per_page: int = Query(20, ge=1, le=200),
    shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db),
):
    """Kayıtlı faturalar: arama (müşteri/takip no/ürün), tür, fatura ve sipariş tarihi süzgeci, sıralama, sayfalama."""
    try:
        return invoices.query_invoices(db, shop, q, kind, inv_start, inv_end, order_start, order_end, sort, page, per_page)
    except ValueError as exc:
        raise HTTPException(422, "Geçersiz tarih") from exc


class DeleteManyIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)


@router.post("/delete")
def delete_many(payload: DeleteManyIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Toplu silme: kalem id'leri (gönderiler seçildiyse içindeki tüm kalemlerin id'leri) tek istekte silinir."""
    return {"deleted": invoices.delete_invoices(db, shop, payload.ids)}


@router.delete("/{invoice_id}")
def delete_invoice(invoice_id: int, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    invoices.delete_invoice(db, shop, invoice_id)
    return {"ok": True}

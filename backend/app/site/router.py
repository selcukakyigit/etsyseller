"""Tanıtım sitesinin herkese açık verisi (giriş gerektirmez). Yalnızca sitede zaten görünen bilgiler döner."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.admin import announcement
from app.billing import custom, price_list
from app.core.db import get_db
from app.site import settings as site_settings

router = APIRouter(prefix="/api/site", tags=["site"])


@router.get("/landing")
def landing():
    return {"social": site_settings.get_social()}


@router.get("/announcement")
def current_announcements(db: Session = Depends(get_db)):
    """Uygulama içi duyuru bantları (aktif ve süresi dolmamış olanlar); yoksa boş liste. Yalnızca yöneticinin herkese göstermek için yazdığı metin döner."""
    try:
        return announcement.current(db)
    except SQLAlchemyError:  # tablo henüz yoksa (göç uygulanmamış) bant yok sayılır
        db.rollback()
        return []


@router.get("/pricing")
def pricing(db: Session = Depends(get_db)):
    """Kredi paketleri ve her işlemin yaklaşık kredi karşılığı. Tablolar henüz yoksa paketsiz döner (site "yakında" gösterir)."""
    try:
        return price_list.build(db)
    except SQLAlchemyError:
        db.rollback()
        return {"enabled": False, "welcome_credits": 0, "packs": [], "custom": None, "actions": []}


@router.get("/quote")
def quote(response: Response, credits: int = Query(...), db: Session = Depends(get_db)):
    """Fiyat sayfasındaki özel miktar hesaplayıcısı: seçilen kredi miktarının fiyatı ve otomatik indirimi. Giriş gerektirmez; hesap, ödemedeki
    hesapla (app/billing/custom.py) aynıdır."""
    try:
        out = custom.quote(db, credits)
    except custom.CustomError as exc:
        raise HTTPException(422, "range" if str(exc) == "range" else "no_products") from exc
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "unavailable") from None
    response.headers["Cache-Control"] = "public, max-age=60"
    return out

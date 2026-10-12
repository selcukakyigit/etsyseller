"""Tanıtım sitesinin herkese açık verisi (giriş gerektirmez). Yalnızca sitede zaten görünen bilgiler döner."""
from fastapi import APIRouter

from app.site import settings as site_settings

router = APIRouter(prefix="/api/site", tags=["site"])


@router.get("/landing")
def landing():
    return {"social": site_settings.get_social()}

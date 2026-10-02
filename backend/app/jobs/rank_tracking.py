"""Günlük sıra ölçümü (bkz. app/insights/rank.py). Takip listesi boş olan mağazaya önce otomatik seçim yapılır.
Demo mağaza ve bağlantısı olmayan mağazalar atlanır; arka plan bütçesi dolunca ölçüm ertesi güne kalır."""
import logging

from app.core.db import SessionLocal
from app.etsy import rate_limit
from app.insights import diagnosis, rank
from app.shops.models import Shop

logger = logging.getLogger(__name__)


def track_all_shops() -> None:
    db = SessionLocal()
    try:
        for shop in db.query(Shop).all():
            if shop.is_demo or shop.oauth_token is None:
                continue
            if not rate_limit.background_budget_ok():
                logger.warning("Sıra takibi: günlük bütçe doldu (%s istek); kalan mağazalar yarına kaldı", rate_limit.calls_today())
                return
            try:
                added = rank.auto_select(db, shop)
                if added:
                    logger.info("Sıra takibi: mağaza %s için %s arama otomatik eklendi", shop.id, added)
                n = rank.run_shop(db, shop)
                if n:
                    logger.info("Sıra takibi: mağaza %s, %s arama ölçüldü", shop.id, n)
                diagnosis.attention(db, shop)  # Dashboard'daki "dikkat isteyen listing'ler" kartı ilk açılışta beklemesin
            except Exception:  # noqa: BLE001 — bir mağazanın hatası diğerlerini durdurmasın
                db.rollback()
                logger.exception("Sıra takibi başarısız (mağaza %s)", shop.id)
    finally:
        db.close()

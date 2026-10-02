"""Finans verisini (Etsy ödeme hesabı hareketleri + ödemeler) periyodik ve artımlı tazeler.

Daha önce bu senkron yalnızca Finans sayfası açılınca ve ledger tamamen boşken başlıyordu; bellek içi bir iş
parçacığında çalıştığı için deploy ya da yeniden başlatmada yarıda ölüyor ve bir daha başlamıyordu. Artımlıdır:
son kayıttan 3 gün geriden devam eder, bu yüzden kesintiden sonra eksik kısmı kendiliğinden tamamlar."""
import logging

from app.core.db import SessionLocal
from app.etsy import rate_limit
from app.finance import service
from app.shops.models import Shop

logger = logging.getLogger(__name__)


def sync_all_shops() -> None:
    db = SessionLocal()
    try:
        shop_ids = [s.id for s in db.query(Shop).all() if s.oauth_token is not None and not s.is_demo]
    finally:
        db.close()
    for shop_id in shop_ids:
        if not rate_limit.background_budget_ok():
            logger.warning("Etsy günlük istek bütçesi doluyor (%s); finans senkronu ertelendi", rate_limit.calls_today())
            return
        db = SessionLocal()
        try:
            shop = db.get(Shop, shop_id)
            if shop is not None:
                service.run_sync_now(shop)
        except Exception:
            logger.exception("Zamanlanmış finans senkronu başarısız (shop %s)", shop_id)
        finally:
            db.close()

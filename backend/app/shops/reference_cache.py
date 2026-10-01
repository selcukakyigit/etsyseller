"""Kargo/işlem/iade profilleri, bölümler ve üretim ortakları için kalıcı yerel önbellek.

Listing'ler, siparişler ve finans nasıl çalışıyorsa bunlar da öyle: Etsy'den BİR KERE çekilir, DB'ye
yazılır; sayfa her açıldığında ya da backend her yeniden başladığında (uvicorn --reload) tekrar Etsy'ye
istek atılmaz. Bir yazma (profil oluştur/güncelle/sil) olunca ilgili `kind` satırı silinir; bir sonraki
okuma o zaman Etsy'den tazeler. Eskiden burada yalnızca süreç-içi bir sözlük (app/core/ttl_cache.py)
vardı — her kod değişikliğinde backend yeniden başlayınca sıfırlanıyor, sayfa her açılışta 5 Etsy isteği
atıyordu; uzun bir çalışma oturumunda bu ekstra yükün ağ hatalarına daha sık denk gelmesine yol açtı."""

import datetime as dt
import json
import logging
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.shops.models import ShippingReferenceCache, Shop

logger = logging.getLogger("app.shipping")


def get_or_fetch(db: Session, shop: Shop, kind: str, loader: Callable[[], Any]) -> Any:
    row = db.scalars(
        select(ShippingReferenceCache).where(ShippingReferenceCache.shop_id == shop.id, ShippingReferenceCache.kind == kind)
    ).one_or_none()
    if row is not None:
        return json.loads(row.data_json)

    value = loader()
    row = ShippingReferenceCache(shop_id=shop.id, kind=kind, data_json=json.dumps(value, ensure_ascii=False), updated_at=dt.datetime.utcnow())
    db.add(row)
    db.commit()
    return value


def set(db: Session, shop: Shop, kind: str, value: Any) -> None:
    """Doğrudan yaz (var/yok fark etmez) — periyodik olarak tazelenen veriler için (ör. mağaza profili:
    Etsy tarafında sessizce değişebiliyor — favori sayısı, yorum ortalaması — bizim bir 'yazma' işlemimiz
    olmadığı için `invalidate` tetiklenmiyor; bunun yerine bir job periyodik olarak `set` çağırır)."""
    row = db.scalars(
        select(ShippingReferenceCache).where(ShippingReferenceCache.shop_id == shop.id, ShippingReferenceCache.kind == kind)
    ).one_or_none()
    if row is None:
        row = ShippingReferenceCache(shop_id=shop.id, kind=kind)
        db.add(row)
    row.data_json = json.dumps(value, ensure_ascii=False)
    row.updated_at = dt.datetime.utcnow()
    db.commit()


def invalidate(db: Session, shop: Shop, kinds: tuple[str, ...] | None = None) -> None:
    """Yazma sonrası ilgili satırları siler; None verilirse hepsini (ör. tam senkronizasyon)."""
    q = select(ShippingReferenceCache).where(ShippingReferenceCache.shop_id == shop.id)
    if kinds:
        q = q.where(ShippingReferenceCache.kind.in_(kinds))
    for row in db.scalars(q).all():
        db.delete(row)
    db.commit()

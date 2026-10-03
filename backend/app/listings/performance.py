"""Listing performansı ve "ne zamandır güncellenmedi" takibi.

Etsy API'si görüntülenme/favori için yalnızca TOPLAM (ömür boyu) sayı verir, geçmiş dönem verisi yoktur. Bu yüzden günlük
anlık görüntü (ListingStatSnapshot) biriktiriyoruz: görüntülenme, favori ve içeriğin (başlık+etiket+açıklama) parmak izi.
Satışlar ise sipariş geçmişinden tam olarak hesaplanır (geriye dönük). İçerik parmak izi değişince "içerik ne zaman
değişti" bilgisini üretiriz; izleme başlamadan önceki değişiklikleri bilemeyiz."""
import datetime as dt
import hashlib
import html
import json
import threading

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.finance import service as fin
from app.finance.models import FinPayment
from app.listings.models import ListingCache, ListingStatSnapshot
from app.orders.models import OrderCache
from app.shops.models import Shop


def content_hash(title: str, tags: list[str], description: str) -> str:
    """Başlık + etiketler + açıklamanın kısa parmak izi (içerik değişince değişir)."""
    payload = json.dumps([html.unescape(title or "").strip(), sorted(t.lower() for t in (tags or [])), html.unescape(description or "").strip()], ensure_ascii=False)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def record_snapshot(db: Session, shop_id: int, item: dict, captured_today: set[int]) -> None:
    """Listing için bugünün anlık görüntüsünü (yoksa) ekler. `item`: Etsy listing nesnesi."""
    lid = item["listing_id"]
    if lid in captured_today:
        return
    captured_today.add(lid)
    db.add(
        ListingStatSnapshot(
            shop_id=shop_id, listing_id=lid, views=item.get("views") or 0, favorites=item.get("num_favorers") or 0,
            content_hash=content_hash(item.get("title", ""), item.get("tags") or [], item.get("description", "")),
        )
    )


def captured_today_ids(db: Session, shop_id: int) -> set[int]:
    start = dt.datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        lid for (lid,) in db.execute(
            select(ListingStatSnapshot.listing_id).where(ListingStatSnapshot.shop_id == shop_id, ListingStatSnapshot.captured_at >= start)
        )
    }


def _snapshots(db: Session, shop_id: int, listing_id: int) -> list[ListingStatSnapshot]:
    return list(
        db.scalars(
            select(ListingStatSnapshot).where(ListingStatSnapshot.shop_id == shop_id, ListingStatSnapshot.listing_id == listing_id).order_by(ListingStatSnapshot.captured_at)
        )
    )


def freshness(snaps: list[ListingStatSnapshot], etsy_last_modified: int | None, today: dt.date) -> dict:
    """İçeriğin son değişikliği. `changed_on`: parmak izi değiştiği gün (izleme sırasında yakalandıysa kesin);
    yoksa `unchanged_for_at_least_days`: izlemenin başlangıcından beri değişmedi. `etsy_last_modified_days` Etsy'nin
    son güncelleme tarihi (fiyat/stok/yenileme gibi işlemler de bunu değiştirir, bu yüzden içerik için üst sınırdır)."""
    hashed = [s for s in snaps if s.content_hash]
    changed_on = None
    for prev, cur in zip(hashed, hashed[1:]):
        if cur.content_hash != prev.content_hash:
            changed_on = cur.captured_at.date()
    out: dict = {
        "tracking_days": (today - hashed[0].captured_at.date()).days if hashed else 0,
        "etsy_last_modified_days": (today - dt.datetime.fromtimestamp(etsy_last_modified, dt.timezone.utc).date()).days if etsy_last_modified else None,
    }
    lm = out["etsy_last_modified_days"]
    if not changed_on:
        out["note"] = (
            "İçerik (başlık/etiket/açıklama) değişikliği izleme sırasında yakalanmadı"
            + (f"; izlemenin {out['tracking_days']} gündür değişmediği biliniyor" if hashed and out["tracking_days"] else "; izleme henüz çok yeni, içeriğin ne zaman değiştiği bilinmiyor")
            + (f". Etsy'nin kayıtlı son değişikliği {lm} gün önce; bu tarih fiyat, stok, yenileme gibi işlemlerle de değişir, içerik güncellemesi anlamına GELMEZ." if lm is not None else ".")
        )
    if changed_on:
        out["content_changed_on"] = changed_on.isoformat()
        out["days_since_content_change"] = (today - changed_on).days
    elif hashed:
        out["unchanged_for_at_least_days"] = out["tracking_days"]
    return out


def _value_at(snaps: list[ListingStatSnapshot], day: dt.date, attr: str, fallback_first: bool) -> tuple[int | None, bool]:
    """`day` tarihinde ya da öncesindeki son anlık görüntü değeri. Yoksa (izleme sonradan başladı) ilk değer ve partial=True."""
    upto = [s for s in snaps if s.captured_at.date() <= day]
    if upto:
        return getattr(upto[-1], attr), False
    if fallback_first and snaps:
        return getattr(snaps[0], attr), True
    return None, False


def metric_delta(snaps: list[ListingStatSnapshot], start: dt.date, end: dt.date) -> dict:
    """Dönem içindeki görüntülenme/favori artışı (ömür boyu sayaçlardaki fark)."""
    if len(snaps) < 2:
        return {"available": False, "reason": "Henüz yeterli günlük geçmiş yok (en az 2 anlık görüntü gerekir)."}
    v_end, _ = _value_at(snaps, end, "views", False)
    if v_end is None:
        return {"available": False, "reason": "Bu döneme ait anlık görüntü yok (izleme sonradan başladı)."}
    v_start, partial = _value_at(snaps, start, "views", True)
    f_end, _ = _value_at(snaps, end, "favorites", False)
    f_start, _ = _value_at(snaps, start, "favorites", True)
    first = snaps[0].captured_at.date()
    return {
        "available": True,
        "views": max(0, (v_end or 0) - (v_start or 0)),
        "favorites": max(0, (f_end or 0) - (f_start or 0)),
        "partial": partial,  # True: izleme dönem başladıktan sonra başladı; değer yalnızca izlenen kısmı kapsar
        "tracking_started": first.isoformat(),
    }


# Günlük satış indeksi: {listing_id: [(gün, adet, ciro), ...]} — tüm siparişler BİR kez taranarak kurulur, sonra herhangi bir
# tarih aralığı toplama ile anında hesaplanır. Siparişler ya da ödeme kayıtları değişince (sürüm anahtarı) yeniden kurulur.
_index_cache: dict[int, tuple[tuple, dict[int, list[tuple[dt.date, int, float]]]]] = {}
_index_lock = threading.Lock()


def _orders_version(db: Session, shop: Shop) -> tuple:
    n, last = db.execute(select(func.count(), func.max(OrderCache.synced_at)).where(OrderCache.shop_id == shop.id)).one()
    pays = db.scalar(select(func.count()).select_from(FinPayment).where(FinPayment.shop_id == shop.id)) or 0
    return (n, str(last), pays)


def _sales_index(db: Session, shop: Shop) -> dict[int, list[tuple[dt.date, int, float]]]:
    version = _orders_version(db, shop)
    with _index_lock:
        cached = _index_cache.get(shop.id)
        if cached and cached[0] == version:
            return cached[1]
    tbl = fin._fx_tables(db, shop)
    per: dict[int, dict[dt.date, list]] = {}
    # Yalnızca gereken sütunlar, parça parça: tüm siparişlerin ham JSON'u aynı anda belleğe alınmaz.
    q = (
        select(OrderCache.receipt_id, OrderCache.created_at, OrderCache.raw_json)
        .where(OrderCache.shop_id == shop.id, OrderCache.is_canceled.is_(False))
        .execution_options(yield_per=200)
    )
    for receipt_id, created_at, raw_json in db.execute(q):
        kc, _ = fin._factors(tbl, receipt_id)
        day = created_at.date()
        for t in json.loads(raw_json).get("transactions") or []:
            qty = t.get("quantity") or 1
            d = per.setdefault(t.get("listing_id"), {}).setdefault(day, [0, 0.0])
            d[0] += qty
            d[1] += fin._money(t.get("price")) * qty * kc
    index = {lid: sorted((day, u, r) for day, (u, r) in days.items()) for lid, days in per.items()}
    with _index_lock:
        _index_cache[shop.id] = (version, index)
    return index


def sales_by_listing(db: Session, shop: Shop, start: dt.date, end: dt.date) -> dict[int, dict]:
    """Dönemdeki listing bazında satış adedi ve tutarı (iptaller hariç; tutar rapor para biriminde, vergi/kargo hariç ürün fiyatı).
    Günlük indeksten hesaplanır; indeks siparişler değişmedikçe yeniden kurulmaz."""
    out: dict[int, dict] = {}
    for lid, rows in _sales_index(db, shop).items():
        u = sum(x[1] for x in rows if start <= x[0] <= end)
        if u:
            out[lid] = {"units": u, "revenue": sum(x[2] for x in rows if start <= x[0] <= end)}
    return out


def _cache_row(db: Session, shop_id: int, listing_id: int) -> ListingCache | None:
    return db.scalars(select(ListingCache).where(ListingCache.shop_id == shop_id, ListingCache.listing_id == listing_id)).one_or_none()


def listing_performance(db: Session, shop: Shop, listing_id: int, start: dt.date, end: dt.date, today: dt.date | None = None) -> dict | None:
    """Tek listing: dönem ve önceki eşit uzunlukta dönem için satış, görüntülenme/favori artışı, dönüşüm ve içerik tazeliği."""
    row = _cache_row(db, shop.id, listing_id)
    if row is None:
        return None
    today = today or dt.date.today()
    raw = json.loads(row.raw_json)
    span = (end - start).days + 1
    pstart, pend = start - dt.timedelta(days=span), start - dt.timedelta(days=1)
    now_sales = sales_by_listing(db, shop, start, end).get(listing_id, {"units": 0, "revenue": 0.0})
    prev_sales = sales_by_listing(db, shop, pstart, pend).get(listing_id, {"units": 0, "revenue": 0.0})
    snaps = _snapshots(db, shop.id, listing_id)
    now_m, prev_m = metric_delta(snaps, start, end), metric_delta(snaps, pstart, pend)
    conv = None
    if now_m.get("available") and now_m["views"] >= 20 and not now_m["partial"]:
        conv = round(now_sales["units"] / now_m["views"] * 100, 2)
    pr = raw.get("price") or {}
    created = raw.get("original_creation_timestamp") or raw.get("creation_timestamp")
    fresh = freshness(snaps, raw.get("last_modified_timestamp"), today)
    return {
        "listing_id": listing_id,
        "title": html.unescape(row.title),
        "state": raw.get("state"),
        "price": round(pr["amount"] / pr["divisor"], 2) if pr.get("divisor") else None,
        "listing_age_days": (today - dt.datetime.fromtimestamp(created, dt.timezone.utc).date()).days if created else None,
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "previous_period": {"start": pstart.isoformat(), "end": pend.isoformat()},
        "sales": {"units": now_sales["units"], "revenue": round(now_sales["revenue"], 2), "prev_units": prev_sales["units"], "prev_revenue": round(prev_sales["revenue"], 2)},
        "views_now": now_m,
        "views_prev": prev_m,
        "lifetime": {"views": row.views or 0, "favorites": row.favorites or 0},
        "conversion_percent": conv,
        "freshness": fresh,
    }


def stale_listings(db: Session, shop: Shop, today: dt.date | None = None, days_window: int = 180) -> list[dict]:
    """Tüm listing'ler için tazelik + son/önceki `days_window` günün satışı. Çağıran filtreler/sıralar."""
    today = today or dt.date.today()
    start = today - dt.timedelta(days=days_window - 1)
    pstart, pend = start - dt.timedelta(days=days_window), start - dt.timedelta(days=1)
    now_s = sales_by_listing(db, shop, start, today)
    prev_s = sales_by_listing(db, shop, pstart, pend)
    snaps_by: dict[int, list[ListingStatSnapshot]] = {}
    for s in db.scalars(select(ListingStatSnapshot).where(ListingStatSnapshot.shop_id == shop.id).order_by(ListingStatSnapshot.captured_at)):
        snaps_by.setdefault(s.listing_id, []).append(s)
    out = []
    for row in db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id)):
        raw = json.loads(row.raw_json)
        if raw.get("state") not in ("active", "inactive", "expired", "sold_out"):
            continue
        f = freshness(snaps_by.get(row.listing_id, []), raw.get("last_modified_timestamp"), today)
        # Sıralama için tek sayı: bilinen içerik değişikliği, yoksa izleme süresi/Etsy'nin son değişikliği (alt sınır)
        age = f.get("days_since_content_change")
        if age is None:
            age = max(f.get("unchanged_for_at_least_days") or 0, f.get("etsy_last_modified_days") or 0)
        n, p = now_s.get(row.listing_id, {"units": 0, "revenue": 0.0}), prev_s.get(row.listing_id, {"units": 0, "revenue": 0.0})
        out.append({
            "listing_id": row.listing_id, "title": html.unescape(row.title), "state": raw.get("state"), "days_since_update": age,
            "exact": "days_since_content_change" in f, "units_recent": n["units"], "units_previous": p["units"],
            "revenue_recent": round(n["revenue"], 2), "views": row.views or 0, "favorites": row.favorites or 0, "freshness": f,
        })
    return out

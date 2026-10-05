"""Sıra takibi: listing, seçilen aramalarda Etsy'de kaçıncı sırada çıkıyor?

Etsy'nin herkese açık arama ucuyla (findAllListingsActive, alaka sıralı; mağaza yetkisi gerekmez) ilk `MAX_RESULTS`
sonuca bakılır; listing'in sırası, aramadaki toplam listing sayısı ve ilk 20 sonucun fiyat aralığı günlük kaydedilir.
Sitedeki aramayla birebir aynı değildir (sitede kişiselleştirme ve reklamlar var) ama sıranın yönü güvenilirdir.

Kota: her arama günde `MAX_RESULTS / 100` istek. Mağaza başına en fazla `MAX_LISTINGS` listing ve listing başına
`MAX_KEYWORDS` arama takip edilir; zamanlanmış ölçüm arka plan bütçesi dolunca durur, ertesi gün devam eder."""
import datetime as dt
import html
import json
import logging
import re
import statistics

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.i18n import tr
from app.etsy import rate_limit
from app.etsy.client import API_BASE, EtsyApiError, _extract_error_message
from app.insights import sales
from app.insights.models import RankSnapshot, TrackedKeyword
from app.listings.models import ListingCache
from app.shops.models import Shop

log = logging.getLogger(__name__)

MAX_LISTINGS = 10
MAX_KEYWORDS = 3
MAX_RESULTS = 200
PAGE = 100
TOP_PRICES = 20
DEFAULT_COUNTRY = "US"  # sipariş geçmişi yoksa: Etsy alıcılarının çoğu ABD'de
KEYWORD_MAX_LEN = 100


class RankError(ValueError):
    pass


# ------------------------------------------------------------------ takip listesi

def _active(db: Session, shop: Shop, listing_id: int | None = None) -> list[TrackedKeyword]:
    q = select(TrackedKeyword).where(TrackedKeyword.shop_id == shop.id, TrackedKeyword.active.is_(True))
    if listing_id is not None:
        q = q.where(TrackedKeyword.listing_id == listing_id)
    return list(db.scalars(q.order_by(TrackedKeyword.created_at)))


def tracked_listing_ids(db: Session, shop: Shop) -> list[int]:
    return sorted({k.listing_id for k in _active(db, shop)})


def _clean(keyword: str) -> str:
    k = re.sub(r"\s+", " ", (keyword or "").strip().lower())[:KEYWORD_MAX_LEN]
    if len(k) < 3:
        raise RankError(tr("Arama en az 3 karakter olmalı.", "The search term must be at least 3 characters."))
    return k


def add_keyword(db: Session, shop: Shop, listing_id: int, keyword: str, source: str = "user") -> TrackedKeyword:
    keyword = _clean(keyword)
    current = _active(db, shop, listing_id)
    if any(k.keyword == keyword for k in current):
        return next(k for k in current if k.keyword == keyword)
    if len(current) >= MAX_KEYWORDS:
        raise RankError(tr(
            f"Bir listing için en fazla {MAX_KEYWORDS} arama takip edilebilir; önce birini çıkar.",
            f"Up to {MAX_KEYWORDS} searches can be tracked per listing; remove one first.",
        ))
    if not current and len(tracked_listing_ids(db, shop)) >= MAX_LISTINGS:
        raise RankError(tr(
            f"En fazla {MAX_LISTINGS} listing takip edilebilir; önce birinin takibini bırak.",
            f"Up to {MAX_LISTINGS} listings can be tracked; stop tracking one first.",
        ))
    row = db.scalars(select(TrackedKeyword).where(
        TrackedKeyword.shop_id == shop.id, TrackedKeyword.listing_id == listing_id, TrackedKeyword.keyword == keyword
    )).one_or_none()
    if row is None:
        row = TrackedKeyword(shop_id=shop.id, listing_id=listing_id, keyword=keyword, source=source)
        db.add(row)
    row.active = True
    db.commit()
    return row


def remove_keyword(db: Session, shop: Shop, listing_id: int, keyword: str) -> None:
    for k in _active(db, shop, listing_id):
        if k.keyword == keyword.strip().lower():
            k.active = False
    db.commit()


def stop_listing(db: Session, shop: Shop, listing_id: int) -> None:
    for k in _active(db, shop, listing_id):
        k.active = False
    db.commit()


def suggest_keywords(db: Session, shop: Shop, listing_id: int) -> list[str]:
    """Takip için aday aramalar: başlığın baş öbeği (ürünün ne olduğu) ve listing'in satış getiren çok kelimeli etiketleri.
    Etiketler, mağazadaki benzer listing'lerde o etiketi taşıyanların gerçek satışına göre sıralanır."""
    from app.keywords.service import _own_tag_agg

    row = db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id, ListingCache.listing_id == listing_id)).one_or_none()
    if row is None:
        return []
    raw = json.loads(row.raw_json)
    title = html.unescape(raw.get("title") or "")
    out: list[str] = []
    head = re.split(r"[,|–—:]| - ", title)[0].strip().lower()
    if 2 <= len(head.split()) <= 5:
        out.append(head)
    agg, _ = _own_tag_agg(db, shop, raw)
    tags = [html.unescape(t).lower() for t in raw.get("tags") or []]
    multi = [t for t in tags if len(t.split()) >= 2]
    multi.sort(key=lambda t: -(agg.get(t, {}).get("units", 0)))
    for t in multi:
        if t not in out:
            out.append(t)
    return out[:6]


def auto_select(db: Session, shop: Shop, today: dt.date | None = None) -> int:
    """Boş takip yerlerini doldurur: en çok düşen 5 ve en çok satan 5 listing, her birine 3 aday arama. Kullanıcı bir
    takibi bilerek bıraktıysa (kapatılmış satır varsa) yerine otomatik yenisi konmaz; seçim artık kullanıcınındır."""
    stopped = db.scalar(select(func.count()).select_from(TrackedKeyword).where(TrackedKeyword.shop_id == shop.id, TrackedKeyword.active.is_(False)))
    already = set(tracked_listing_ids(db, shop))
    if stopped or len(already) >= MAX_LISTINGS:
        return 0
    today = today or dt.date.today()
    idx = sales.index(db, shop)
    active_ids = {
        lid for lid, raw in db.execute(select(ListingCache.listing_id, ListingCache.raw_json).where(ListingCache.shop_id == shop.id))
        if json.loads(raw).get("state") == "active"
    }
    stats = []
    for lid, rows in idx.items():
        if lid not in active_ids:
            continue
        last12 = sales.units_between(rows, today - dt.timedelta(days=364), today)
        prev12 = sales.units_between(rows, today - dt.timedelta(days=729), today - dt.timedelta(days=365))
        stats.append((lid, last12, prev12))
    decliners = sorted((s for s in stats if s[2] >= 8 and s[1] < s[2] * 0.7), key=lambda s: s[1] - s[2])[:5]
    chosen = list(already) + [s[0] for s in decliners if s[0] not in already]
    for lid, _, _ in sorted(stats, key=lambda s: -s[1]):
        if len(chosen) >= MAX_LISTINGS:
            break
        if lid not in chosen:
            chosen.append(lid)
    added = 0
    for lid in chosen[:MAX_LISTINGS]:
        if lid in already:
            continue
        for kw in suggest_keywords(db, shop, lid)[:MAX_KEYWORDS]:
            try:
                add_keyword(db, shop, lid, kw, source="auto")
                added += 1
            except RankError:
                break
    return added


# ------------------------------------------------------------------ ölçüm

def buyer_country(db: Session, shop: Shop) -> tuple[str, bool]:
    """Sıranın hangi ülkedeki alıcıya göre ölçüleceği: (ISO kod, otomatik mi). Mağaza ayarında seçilmişse o; değilse son
    12 ayda en çok sipariş gelen ülke (6 saat önbellekte), sipariş yoksa ABD. Etsy aramayı alıcının ülkesine gönderim
    yapan listing'lerle sınırlar; Avrupa'ya satan bir mağaza için ABD sıralaması yanıltıcı olurdu."""
    from app.core import ttl_cache
    from app.orders.models import OrderCache

    if shop.rank_country:
        return shop.rank_country, False

    def load() -> str:
        since = dt.datetime.utcnow() - dt.timedelta(days=365)
        row = db.execute(
            select(OrderCache.country_iso, func.count()).where(
                OrderCache.shop_id == shop.id, OrderCache.created_at >= since, OrderCache.country_iso.is_not(None), OrderCache.country_iso != "",
            ).group_by(OrderCache.country_iso).order_by(func.count().desc()).limit(1)
        ).first()
        return str(row[0]).upper() if row else DEFAULT_COUNTRY

    return ttl_cache.cached(("rank_country", shop.id), load), True


def _search(keyword: str, offset: int, currency: str, country: str = DEFAULT_COUNTRY) -> dict:
    params = {"keywords": keyword, "sort_on": "score", "limit": PAGE, "offset": offset, "buyer_country": country}
    if currency:
        params["currency"] = currency
    rate_limit.throttle()
    resp = httpx.get(f"{API_BASE}/listings/active", headers={"x-api-key": f"{settings.etsy_api_key}:{settings.etsy_shared_secret}"}, params=params, timeout=30)
    if resp.is_error:
        raise EtsyApiError(resp.status_code, _extract_error_message(resp))
    return resp.json()


def _price(item: dict) -> float | None:
    p = item.get("converted_price") or item.get("price")
    if not p or not p.get("divisor"):
        return None
    return p["amount"] / p["divisor"]


def measure(db: Session, shop: Shop, listing_id: int, keyword: str, today: dt.date | None = None) -> RankSnapshot:
    """Tek bir aramayı ölçer ve günün kaydını yazar (aynı gün ikinci ölçüm öncekinin üstüne yazar)."""
    today = today or dt.date.today()
    row = db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id, ListingCache.listing_id == listing_id)).one_or_none()
    raw = json.loads(row.raw_json) if row else {}
    own_money = raw.get("price") or {}
    currency = own_money.get("currency_code") or ""
    own_price = own_money["amount"] / own_money["divisor"] if own_money.get("divisor") else None

    position, total, top_prices = None, 0, []
    country, _ = buyer_country(db, shop)
    for offset in range(0, MAX_RESULTS, PAGE):
        data = _search(keyword, offset, currency, country)
        total = int(data.get("count") or 0)
        results = data.get("results") or []
        for i, item in enumerate(results):
            if offset + i < TOP_PRICES:
                p = _price(item)
                if p is not None:
                    top_prices.append(p)
            if item.get("listing_id") == listing_id and position is None:
                position = offset + i + 1
        if position is not None or len(results) < PAGE or offset + PAGE >= total:
            break

    snap = db.scalars(select(RankSnapshot).where(
        RankSnapshot.shop_id == shop.id, RankSnapshot.listing_id == listing_id, RankSnapshot.keyword == keyword, RankSnapshot.day == today
    )).one_or_none() or RankSnapshot(shop_id=shop.id, listing_id=listing_id, keyword=keyword, day=today)
    snap.position = position
    snap.total_results = total
    snap.top_price_median = round(statistics.median(top_prices), 2) if top_prices else None
    snap.top_price_low = round(min(top_prices), 2) if top_prices else None
    snap.top_price_high = round(max(top_prices), 2) if top_prices else None
    snap.own_price = own_price
    snap.currency = currency
    snap.captured_at = dt.datetime.utcnow()
    db.add(snap)
    db.commit()
    return snap


def measure_listing(db: Session, shop: Shop, listing_id: int, today: dt.date | None = None) -> int:
    """Listing'in tüm aktif aramalarını hemen ölçer (kullanıcı isteği; "Şimdi ölç")."""
    if shop.is_demo:
        raise RankError(tr("Demo mağazada sıra ölçülmez.", "Rankings are not measured for the demo shop."))
    n = 0
    for k in _active(db, shop, listing_id):
        measure(db, shop, listing_id, k.keyword, today)
        n += 1
    return n


def run_shop(db: Session, shop: Shop, today: dt.date | None = None) -> int:
    """Zamanlanmış ölçüm: bugün henüz ölçülmemiş aramaları, arka plan bütçesi elverdikçe ölçer."""
    today = today or dt.date.today()
    done = {(lid, kw) for lid, kw in db.execute(select(RankSnapshot.listing_id, RankSnapshot.keyword).where(RankSnapshot.shop_id == shop.id, RankSnapshot.day == today))}
    n = 0
    for k in _active(db, shop):
        if (k.listing_id, k.keyword) in done:
            continue
        if not rate_limit.background_budget_ok():
            log.warning("Sıra takibi: günlük bütçe doldu, kalan aramalar yarına kaldı (mağaza %s)", shop.id)
            break
        try:
            measure(db, shop, k.listing_id, k.keyword, today)
            n += 1
        except Exception:  # noqa: BLE001 — bir arama başarısız olursa diğerleri ölçülmeye devam eder
            log.warning("Sıra ölçülemedi: mağaza %s listing %s '%s'", shop.id, k.listing_id, k.keyword, exc_info=True)
    return n


# ------------------------------------------------------------------ okuma

def _change(series: list[RankSnapshot], back: int) -> int | None:
    """Pozitif = yükseldi (sıra numarası küçüldü). Listede yoksa MAX_RESULTS+1 sayılır."""
    if not series:
        return None
    latest = series[-1]
    target = latest.day - dt.timedelta(days=back)
    older = [s for s in series if s.day <= target]
    if not older:
        return None
    a = older[-1].position or MAX_RESULTS + 1
    b = latest.position or MAX_RESULTS + 1
    return a - b


def shop_summary(db: Session, shop: Shop, today: dt.date | None = None) -> dict:
    """Takipteki listing'lerin özeti (liste rozeti ve "Takipte" filtresi için): her biri için en iyi sıradaki arama,
    o sıra ve 7 günlük değişimi. Henüz ölçülmemişse `position` ve `measured` boş döner."""
    today = today or dt.date.today()
    keywords = _active(db, shop)
    snaps = db.scalars(select(RankSnapshot).where(
        RankSnapshot.shop_id == shop.id, RankSnapshot.day >= today - dt.timedelta(days=14)
    ).order_by(RankSnapshot.day)).all()
    series: dict[tuple[int, str], list[RankSnapshot]] = {}
    for s in snaps:
        series.setdefault((s.listing_id, s.keyword), []).append(s)
    out: dict[int, dict] = {}
    for k in keywords:
        ser = series.get((k.listing_id, k.keyword), [])
        latest = ser[-1] if ser else None
        item = {
            "keyword": k.keyword,
            "position": latest.position if latest else None,
            "measured": latest.day.isoformat() if latest else None,
            "change_7d": _change(ser, 7),
        }
        cur = out.get(k.listing_id)
        # En iyi arama: ölçülmüş olan, sonra sıra numarası en küçük olan (ilk 200'de yoksa en sona).
        rank_of = lambda i: (i["measured"] is None, i["position"] or MAX_RESULTS + 1)  # noqa: E731
        if cur is None or rank_of(item) < rank_of(cur):
            out[k.listing_id] = {**item, "keywords": (cur or {}).get("keywords", 0)}
        out[k.listing_id]["keywords"] = out[k.listing_id].get("keywords", 0) + 1
    if out:
        titles = dict(db.execute(select(ListingCache.listing_id, ListingCache.title).where(
            ListingCache.shop_id == shop.id, ListingCache.listing_id.in_(list(out))
        )).all())
        for lid, item in out.items():
            item["title"] = html.unescape(titles.get(lid) or "")
    return {"listings": out, "max_listings": MAX_LISTINGS, "max_results": MAX_RESULTS}


def listing_ranks(db: Session, shop: Shop, listing_id: int, days: int = 60, today: dt.date | None = None) -> dict:
    today = today or dt.date.today()
    since = today - dt.timedelta(days=days - 1)
    keywords = _active(db, shop, listing_id)
    snaps = db.scalars(select(RankSnapshot).where(
        RankSnapshot.shop_id == shop.id, RankSnapshot.listing_id == listing_id, RankSnapshot.day >= since
    ).order_by(RankSnapshot.day)).all()
    by_kw: dict[str, list[RankSnapshot]] = {}
    for s in snaps:
        by_kw.setdefault(s.keyword, []).append(s)

    change = _change
    out = []
    for k in keywords:
        series = by_kw.get(k.keyword, [])
        latest = series[-1] if series else None
        out.append({
            "keyword": k.keyword, "source": k.source,
            "position": latest.position if latest else None, "measured": latest.day.isoformat() if latest else None,
            "total_results": latest.total_results if latest else None,
            "top_price_median": latest.top_price_median if latest else None,
            "top_price_low": latest.top_price_low if latest else None, "top_price_high": latest.top_price_high if latest else None,
            "own_price": latest.own_price if latest else None, "currency": latest.currency if latest else "",
            "change_7d": change(series, 7), "change_30d": change(series, 30),
            "history": [{"day": s.day.isoformat(), "position": s.position} for s in series],
        })
    country, country_auto = buyer_country(db, shop)
    return {
        "keywords": out, "max_keywords": MAX_KEYWORDS, "max_listings": MAX_LISTINGS, "max_results": MAX_RESULTS,
        "country": country, "country_auto": country_auto,
        "tracked_listings": len(tracked_listing_ids(db, shop)), "is_tracked": bool(keywords),
        "suggestions": [s for s in suggest_keywords(db, shop, listing_id) if s not in {k.keyword for k in keywords}][:5],
    }


def first_measured(db: Session, shop: Shop, listing_id: int) -> dt.date | None:
    return db.scalar(select(func.min(RankSnapshot.day)).where(RankSnapshot.shop_id == shop.id, RankSnapshot.listing_id == listing_id))

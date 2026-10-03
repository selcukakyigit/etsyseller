"""Listing performans sağlığı: "yeter mi bekleyelim mi, dokunma zamanı geldi mi, geldiyse neye" sorusuna
kural tabanlı cevap. YZ burada karar vermez, yalnızca teşhis edilen alan (seo/appeal/conversion) için
içerik üretir — karar (`jobs/listing_health.py` tarafından günlük çalıştırılan `evaluate_shop`) tamamen
deterministiktir, böylece "değiştir, birkaç gün bekle, tekrar değiştir" döngüsü önlenir.

Akış:
  1. Olgunluk eşiği: pencere en az MIN_DAYS gün sürmüş VEYA MIN_VIEWS görüntülenme birikmiş olmalı.
     Pencere, Etsy'ye giden son değişiklikle (ListingChange: Ulagg'dan yayın ya da Etsy'de yapılan metin değişikliği)
     ya da listing'in oluşturulma tarihiyle başlar — her yayın yeni bir pencere açar (soğuma).
  2. Teşhis: mağazadaki diğer olgun listing'lerin medyanına karşı günlük görüntülenme / favori oranı /
     dönüşüm — hangisi mağaza medyanının yarısının altındaysa orası darboğaz.
  3. Aynı darboğaz MAX_ATTEMPTS kez denenip düzelmezse "kill_candidate": listing'i durdurmayı düşün.
"""
import datetime as dt
import json
import statistics

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.etsy import listings as etsy_listings
from app.etsy.client import EtsyClient
from app.listings import performance
from app.listings.models import ListingCache, ListingChange, ListingHealth
from app.shops.models import Shop

MIN_DAYS = 21
MIN_VIEWS = 100
MAX_ATTEMPTS = 3
WEAK_RATIO = 0.5  # mağaza medyanının bu oranının altındaysa "zayıf" sayılır
MIN_BENCHMARK_SAMPLE = 3  # kıyaslanacak en az bu kadar başka olgun listing olmalı

BOTTLENECK_LABEL = {
    "seo": "Arama görünürlüğü zayıf (etiket/başlık/kategori sorunu olabilir)",
    "appeal": "Görüntülenme var ama favoriye dönmüyor (kapak görseli/başlık çekiciliği zayıf olabilir)",
    "conversion": "Favori var ama satışa dönmüyor (açıklama/fiyat/varyasyon sorunu olabilir)",
}


def _created_at(raw: dict, fallback: dt.datetime) -> dt.datetime:
    ts = raw.get("original_creation_timestamp") or raw.get("creation_timestamp")
    return dt.datetime.utcfromtimestamp(ts) if ts else fallback


def _last_applied(db: Session, shop_id: int, listing_id: int) -> dt.datetime | None:
    return db.execute(
        select(func.max(ListingChange.published_at)).where(ListingChange.shop_id == shop_id, ListingChange.listing_id == listing_id)
    ).scalar()


def _shop_benchmarks(db: Session, shop: Shop, today: dt.date) -> dict:
    """Mağazadaki aktif listing'lerin son 90 gündeki günlük görüntülenme / favori oranı / dönüşüm medyanı.
    Az veri veren (< 20 görüntülenme) ya da izlemesi dönem ortasında başlamış listing'ler dışarıda bırakılır."""
    start = today - dt.timedelta(days=89)
    sales = performance.sales_by_listing(db, shop, start, today)
    views_per_day, fav_rates, convs = [], [], []
    for row in db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id)):
        raw = json.loads(row.raw_json)
        if raw.get("state") != "active":
            continue
        snaps = performance._snapshots(db, shop.id, row.listing_id)
        m = performance.metric_delta(snaps, start, today)
        if not m.get("available") or m.get("partial") or m["views"] < 20:
            continue
        views_per_day.append(m["views"] / 90)
        fav_rates.append(m["favorites"] / m["views"])
        units = sales.get(row.listing_id, {"units": 0})["units"]
        convs.append(units / m["views"] * 100)
    return {
        "views_per_day": statistics.median(views_per_day) if views_per_day else None,
        "favorite_rate": statistics.median(fav_rates) if fav_rates else None,
        "conversion_percent": statistics.median(convs) if convs else None,
        "sample_size": len(views_per_day),
    }


def _evaluate_one(db: Session, shop: Shop, row: ListingCache, raw: dict, health: ListingHealth, bench: dict, today: dt.date) -> None:
    now = dt.datetime.utcnow()
    last_applied = _last_applied(db, shop.id, row.listing_id)
    window_start = health.window_start or _created_at(raw, now)

    # Son teşhisten SONRA yeni bir değişiklik uygulanmışsa yeni bir döngü/pencere başlamış demektir.
    if last_applied and (health.window_start is None or last_applied > health.window_start):
        tried = json.loads(health.tried_bottlenecks or "[]")
        if health.bottleneck and health.bottleneck not in tried:
            tried.append(health.bottleneck)
        health.tried_bottlenecks = json.dumps(tried)
        health.attempts = (health.attempts or 0) + 1
        health.bottleneck = None
        window_start = last_applied

    health.window_start = window_start
    health.evaluated_at = now

    days = max((today - window_start.date()).days, 0)
    snaps = performance._snapshots(db, shop.id, row.listing_id)
    m = performance.metric_delta(snaps, window_start.date(), today)
    views_in_window = m["views"] if m.get("available") else 0
    mature = days >= MIN_DAYS or views_in_window >= MIN_VIEWS

    if not mature:
        health.stage = "watching"
        health.note = f"Veri birikiyor: {days} gün, {views_in_window} görüntülenme (en az {MIN_DAYS} gün ya da {MIN_VIEWS} görüntülenme gerekli)."
        return

    if bench["sample_size"] < MIN_BENCHMARK_SAMPLE:
        health.stage = "watching"
        health.note = "Mağazada kıyaslanacak yeterli sayıda olgun listing yok; sağlıklı bir karşılaştırma yapılamıyor."
        return

    views_per_day = views_in_window / max(days, 1)
    fav_rate = (m["favorites"] / m["views"]) if m.get("available") and m["views"] else 0.0
    sales = performance.sales_by_listing(db, shop, window_start.date(), today).get(row.listing_id, {"units": 0})
    conv = (sales["units"] / m["views"] * 100) if m.get("available") and m["views"] else 0.0

    bottleneck = None
    if bench["views_per_day"] and views_per_day < bench["views_per_day"] * WEAK_RATIO:
        bottleneck = "seo"
    elif bench["favorite_rate"] and fav_rate < bench["favorite_rate"] * WEAK_RATIO:
        bottleneck = "appeal"
    elif bench["conversion_percent"] is not None and conv < bench["conversion_percent"] * WEAK_RATIO:
        bottleneck = "conversion"

    if bottleneck is None:
        health.stage = "stable"
        health.bottleneck = None
        health.attempts = 0
        health.tried_bottlenecks = "[]"
        health.note = "Performans mağaza medyanına yakın veya üzerinde — dokunmaya gerek yok."
        return

    if (health.attempts or 0) >= MAX_ATTEMPTS:
        tried = json.loads(health.tried_bottlenecks or "[]")
        health.stage = "kill_candidate"
        health.bottleneck = bottleneck
        health.note = (
            f"{MAX_ATTEMPTS} farklı değişiklik döngüsüne rağmen ({', '.join(BOTTLENECK_LABEL.get(t, t) for t in tried) or bottleneck}) "
            "performans hâlâ mağaza medyanının altında. Bu listing'i durdurmayı (inactive) değerlendir."
        )
        return

    health.stage = "flagged"
    health.bottleneck = bottleneck
    health.note = (
        f"{BOTTLENECK_LABEL[bottleneck]}. Günlük görüntülenme {views_per_day:.1f} (medyan {bench['views_per_day']:.1f}), "
        f"favori oranı %{fav_rate * 100:.1f} (medyan %{(bench['favorite_rate'] or 0) * 100:.1f}), "
        f"dönüşüm %{conv:.1f} (medyan %{bench['conversion_percent']:.1f})."
    )


def evaluate_shop(db: Session, shop: Shop, today: dt.date | None = None) -> None:
    today = today or dt.date.today()
    bench = _shop_benchmarks(db, shop, today)
    existing = {h.listing_id: h for h in db.scalars(select(ListingHealth).where(ListingHealth.shop_id == shop.id))}
    for row in db.scalars(select(ListingCache).where(ListingCache.shop_id == shop.id)):
        raw = json.loads(row.raw_json)
        if raw.get("state") not in ("active", "sold_out"):
            continue
        health = existing.get(row.listing_id)
        if health is None:
            health = ListingHealth(shop_id=shop.id, listing_id=row.listing_id)
            db.add(health)
        if health.stage == "killed":
            continue  # kullanıcı zaten durdurdu, yeniden değerlendirme
        _evaluate_one(db, shop, row, raw, health, bench, today)
    db.commit()


def get_shop_health(db: Session, shop: Shop) -> list[ListingHealth]:
    return list(db.scalars(select(ListingHealth).where(ListingHealth.shop_id == shop.id)))


def get_listing_health(db: Session, shop: Shop, listing_id: int) -> ListingHealth | None:
    return db.scalars(
        select(ListingHealth).where(ListingHealth.shop_id == shop.id, ListingHealth.listing_id == listing_id)
    ).one_or_none()


def kill_listing(db: Session, shop: Shop, listing_id: int) -> ListingHealth:
    """Kullanıcı onayıyla listing'i Etsy'de inactive yapar (geri alınabilir — tekrar active edilebilir)."""
    client = EtsyClient(db, shop)
    etsy_listings.update_listing(client, listing_id, {"state": "inactive"})

    row = db.scalars(
        select(ListingCache).where(ListingCache.shop_id == shop.id, ListingCache.listing_id == listing_id)
    ).one_or_none()
    if row is not None:
        raw = json.loads(row.raw_json)
        raw["state"] = "inactive"
        row.raw_json = json.dumps(raw, ensure_ascii=False)

    health = get_listing_health(db, shop, listing_id)
    if health is None:
        health = ListingHealth(shop_id=shop.id, listing_id=listing_id)
        db.add(health)
    health.stage = "killed"
    health.killed_at = dt.datetime.utcnow()
    health.note = "Kullanıcı onayıyla durduruldu (Etsy'de inactive)."
    db.commit()
    return health


def keep_watching(db: Session, shop: Shop, listing_id: int) -> ListingHealth:
    """Kullanıcı 'durdurma' önerisini reddetti: sayaç sıfırlanır, yeni bir gözlem penceresi başlar."""
    health = get_listing_health(db, shop, listing_id)
    if health is None:
        raise ValueError("Listing için sağlık kaydı bulunamadı")
    health.stage = "watching"
    health.bottleneck = None
    health.attempts = 0
    health.tried_bottlenecks = "[]"
    health.window_start = dt.datetime.utcnow()
    health.note = "Kullanıcı izlemeye devam etmeyi seçti; gözlem penceresi sıfırlandı."
    db.commit()
    return health

"""Etsy'deki ilk sonuçların analizi: bir aramada "rekabet kalitesi". Etsy'nin herkese açık aktif ilan aramasının (uygulamanın kendi API anahtarıyla; mağaza yetkisi
gerekmez) ilk 20 sonucundan: toplam ilan sayısı, KANITLANMIŞ ilan sayısı (>= PROVEN_FAVORITES favorisi olan), fiyat bandı, yeni giriş payı ve en sık kullanılan etiketler.

Neden "medyan favori" değil: Etsy'nin ilk 20'si çok sayıda yeni ve henüz favorisi olmayan ilan içerir (gerçek denemede medyan hemen hep 0-1); ayırt eden ölçüt,
ilk 20'nin kaçının gerçekten tutmuş olduğudur (aramalara göre 1 ile 13 arasında değişti).

DİKKAT: Etsy API'si yalnızca `sort_on=score` verir; bu sıra sitedeki "Most relevant" sıralamasından çok farklıdır (sitede yorumu, satışı ve reklamı olan ilanlar
önde; API'de yeni ve etkileşimi düşük ilanlar öne çıkar; gerçek aramalarla karşılaştırıldı, bkz. docs/ARASTIRMA_YOL_HARITASI.md). Bu yüzden buradaki "ilk 20" bir
ÖRNEKTİR, alıcının gördüğü ilk 20 değildir; ondan bir rekabet GÜCÜ hükmü (düşük/orta/yüksek) üretilmez, yalnızca sayılar ve dağılımlar verilir.

Etsy API şartları gereği ilan içeriği KALICI SAKLANMAZ: yalnızca kısa süreli bellek önbelleği (CACHE_SECONDS) kullanılır, sonuç havuza yazılmaz. Etsy verisidir;
Google ölçümleriyle karıştırılmaz (arayüzde ayrı gösterilir)."""
import statistics
import threading
import time
from collections import Counter

from app.core.limits import SlidingWindow
from app.research.terms import normalize, researchable

SAMPLE = 20
CACHE_SECONDS = 3600  # Etsy kuralı: ilan verisi en fazla 6 saat eski gösterilebilir; payla güvenli tarafta
NEW_DAYS = 90  # "yeni giriş": bu kadar günden genç ilan
PROVEN_FAVORITES = 10  # "kanıtlanmış ilan": en az bu kadar favorisi olan
STRONG_FAVORITES = 50
TOP_TAGS = 15

_limiter = SlidingWindow(limit=20, window=600)  # mağaza başına 10 dakikada en fazla 20 analiz (her biri 1 Etsy isteği; günlük kota ortak)
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def _quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    pos = (len(s) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def _round(v: float | None, digits: int = 1) -> float | None:
    return None if v is None else round(v, digits)


def summarize(term: str, data: dict, now: float | None = None, thumbnails: dict[int, str] | None = None) -> dict:
    """Etsy arama yanıtından (`{"count", "results"}`) analiz özeti. Saf işlev: ağ yok. `thumbnails`: ilan kimliği -> küçük resim adresi."""
    now = now or time.time()
    thumbnails = thumbnails or {}
    results = list(data.get("results") or [])[:SAMPLE]
    currency = Counter((r.get("price") or {}).get("currency_code") for r in results if r.get("price")).most_common(1)
    currency = currency[0][0] if currency else None
    listings, prices, favorites, views_all, ages = [], [], [], [], []
    tags: Counter[str] = Counter()
    for r in results:
        price = r.get("price") or {}
        amount = price["amount"] / price["divisor"] if price.get("divisor") else None
        created = r.get("original_creation_timestamp") or r.get("created_timestamp") or now
        age_days = max(0.0, (now - created) / 86400)
        views, favs = int(r.get("views") or 0), int(r.get("num_favorers") or 0)
        favorites.append(favs)
        views_all.append(views)
        ages.append(age_days)
        if amount is not None and price.get("currency_code") == currency:
            prices.append(amount)
        for tag in r.get("tags") or []:
            tags[normalize(str(tag))] += 1
        listings.append({
            "listing_id": r.get("listing_id"), "title": r.get("title") or "", "url": r.get("url") or "", "image": thumbnails.get(r.get("listing_id")), "price": _round(amount, 2), "currency": price.get("currency_code"),
            "favorites": favs, "views": views, "age_days": round(age_days), "shop_id": r.get("shop_id"), "personalizable": bool(r.get("is_personalizable")),
        })
    n = len(results)
    proven = sum(1 for f in favorites if f >= PROVEN_FAVORITES)
    return {
        "term": term, "total": int(data.get("count") or 0), "sample": n, "currency": currency,
        "price": {"p25": _round(_quantile(prices, 0.25), 2), "median": _round(_quantile(prices, 0.5), 2), "p75": _round(_quantile(prices, 0.75), 2)},
        "proven": proven, "strong": sum(1 for f in favorites if f >= STRONG_FAVORITES),
        "favorites": {"p75": _round(_quantile(favorites, 0.75)), "max": max(favorites) if favorites else None},
        "views": {"median": _round(statistics.median(views_all)) if views_all else None},
        "age_days_median": round(statistics.median(ages)) if ages else None,
        "new_share": _round(sum(1 for a in ages if a < NEW_DAYS) / n, 2) if n else None,
        "top_tags": [{"tag": tag, "count": c} for tag, c in tags.most_common(TOP_TAGS) if c >= 2],
        "listings": listings,
    }


def fetch(shop_id: int, term: str) -> dict | None:
    """Terimi analiz eder. Mağaza ölçüm hakkı dolduysa None; geçersiz terimde boş sözlük. Etsy çağrısı bir saat önbellekte kalır."""
    key = normalize(term)
    if not researchable(key):
        return {}
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_SECONDS:
        return hit[1]
    if not _limiter.hit(shop_id):
        return None
    from app.taxonomy import service as taxonomy_service

    data = taxonomy_service.search_active_listings(key, limit=SAMPLE)
    try:
        thumbnails = taxonomy_service.listing_thumbnails([r.get("listing_id") for r in (data.get("results") or [])[:SAMPLE]])
    except Exception:  # resimler süs: alınamazsa analiz resimsiz gösterilir
        thumbnails = {}
    out = summarize(key, data, thumbnails=thumbnails)
    with _lock:
        if len(_cache) > 300:  # bellek sınırı
            _cache.clear()
        _cache[key] = (now, out)
    return out

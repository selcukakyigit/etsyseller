import datetime as dt
import logging
import math
from collections import Counter

from sqlalchemy.orm import Session

from app.ai import quality
from app.etsy import search as etsy_search
from app.listings import performance
from app.shops.models import Shop

logger = logging.getLogger(__name__)

OWN_LISTINGS = 6  # etiketleri havuza alınacak, bu listing'e en benzer kendi listing'lerin sayısı
OWN_TAGS = 15
COMPETITOR_SAMPLE = 50
COMPETITOR_TAGS = 15
POOL_SIZE = OWN_TAGS + COMPETITOR_TAGS
WINNER_WINDOW_DAYS = 180
MIN_RELEVANCE = 0.12  # ağırlıklı kelime benzerliği bunun altındaysa listing "alakasız" sayılır


def _own_tags(db: Session, shop: Shop, listing: dict) -> list[dict]:
    """Senin ALAKALI listing'lerinden etiketler, GERÇEK SATIŞA göre sıralı.

    Eski yöntem, aynı kategorideki listing'leri günlük anlık görüntülerdeki görüntülenme artışıyla sıralıyordu; bu geçmiş
    çok kısa olduğunda (ör. 2 gün) rastgele sonuç veriyordu ve kategori çok geniş olduğunda (Wall Decor) alakasız ürünlerin
    etiketlerini getiriyordu. Şimdi: (1) bu listing'in başlık+etiketlerine kelime benzerliği, (2) son 180 gündeki gerçek
    satış adedi (sipariş geçmişi tam olduğu için güvenilir). Yerel veriden hesaplanır, Etsy'ye istek atmaz."""
    lid = listing.get("listing_id")
    others = quality.shop_others(db, shop.id, exclude_id=lid)
    target = quality._words(f"{listing.get('title', '')} {' '.join(listing.get('tags') or [])}")
    docs = [quality._words(f"{o['title']} {' '.join(o['tags'])}") for o in others]

    # Kelime ağırlığı (IDF): mağazadaki her listing'de geçen kelimeler (metal, wall, art, decor…) benzerliği şişirmesin;
    # ayırt edici kelimeler (geometric, chess, mirror, farm…) ağır bassın.
    df: Counter[str] = Counter(w for d in docs for w in d)
    n_docs = max(len(docs), 1)
    weight = lambda w: math.log((n_docs + 1) / (df.get(w, 0) + 1)) + 0.05  # noqa: E731

    def wjaccard(a: set[str], b: set[str]) -> float:
        union = sum(weight(w) for w in a | b)
        return sum(weight(w) for w in a & b) / union if union else 0.0

    today = dt.date.today()
    sales = performance.sales_by_listing(db, shop, today - dt.timedelta(days=WINNER_WINDOW_DAYS - 1), today)

    ranked = []
    for o, words in zip(others, docs):
        rel = wjaccard(target, words)
        if rel < MIN_RELEVANCE:
            continue
        units = sales.get(o["listing_id"], {}).get("units", 0)
        # Alaka öncelikli; satış yalnızca hafif bir çarpan (çok satan ama az alakalı ürün öne geçmesin)
        ranked.append((rel * (1 + 0.35 * math.log1p(units)), rel, units, o))
    ranked.sort(key=lambda r: -r[0])
    chosen = ranked[:OWN_LISTINGS]

    mine = {t.lower() for t in (listing.get("tags") or [])}
    agg: dict[str, dict] = {}
    for _, _, units, o in chosen:
        for tag in o["tags"]:
            key = tag.lower()
            d = agg.setdefault(key, {"tag": key, "units": 0, "n": 0, "from": []})
            d["units"] += units
            d["n"] += 1
            if len(d["from"]) < 2:
                d["from"].append(o["title"][:60])
    out = sorted(agg.values(), key=lambda d: (-d["units"], -d["n"]))[:OWN_TAGS]
    return [
        {
            "tag": d["tag"], "source": "own", "score": d["n"], "sample_size": len(chosen), "units": d["units"],
            "from_listings": d["from"], "in_listing": d["tag"] in mine,
        }
        for d in out
    ]


def _anchor_keywords(listing: dict) -> str | None:
    """A short, natural search phrase for this listing (its title up to the
    first comma/pipe) — Etsy's own docs say sort_on=score "only works when
    combined with one of the search options (keywords, region, etc.)";
    taxonomy_id alone doesn't count. Without a real keywords term, "top
    scoring in category X" can surface listings that are mis-categorized —
    sellers cross-listing unrelated products under a high-traffic category
    to farm impressions — which is exactly what taxonomy-only search returned
    in testing (unrelated mobile-game/service listings in "Wall Decor")."""
    title = (listing.get("title") or "").strip()
    if not title:
        return None
    for sep in (",", "|", "-", ":"):
        if sep in title:
            title = title.split(sep, 1)[0].strip()
            break
    return title or None


def _competitor_tags(taxonomy_id: int | None, keywords: str | None) -> tuple[Counter, int]:
    """Tag frequency among top-scoring active listings in the same category
    AND matching the listing's own anchor keyword phrase — a free proxy for
    competition level (no extra Etsy request per keyword, unlike a real
    search-volume lookup). Returns (tag -> how many of the sampled listings
    use it, how many listings were sampled)."""
    if not taxonomy_id and not keywords:
        return Counter(), 0
    try:
        results = etsy_search.find_active_listings(
            taxonomy_id=taxonomy_id, keywords=keywords, limit=COMPETITOR_SAMPLE
        )
    except Exception:
        logger.exception("Keyword pool: competitor search failed for taxonomy %s", taxonomy_id)
        return Counter(), 0

    counts: Counter[str] = Counter()
    for item in results:
        for tag in item.get("tags") or []:
            counts[tag.lower()] += 1
    return counts, len(results)


def build_keyword_pool(db: Session, shop: Shop, listing: dict) -> list[dict]:
    """Aday anahtar kelime havuzu (SEO önerisine ve arayüze girdi): `OWN_TAGS` kadar senin alakalı listing'lerinden
    (gerçek satışa göre sıralı) + `COMPETITOR_TAGS` kadar rakip etiketi (ilk 50 rakip listing'te kaç kez geçtiğine göre).
    Slotlar ayrıdır, bu yüzden rakip verisi kendi etiketlerin tarafından ezilmez."""
    pool = _own_tags(db, shop, listing)
    seen = {item["tag"] for item in pool}

    competitor_counts, competitor_sample = _competitor_tags(listing.get("taxonomy_id"), _anchor_keywords(listing))
    added = 0
    for tag, score in competitor_counts.most_common():
        if tag in seen:
            continue
        seen.add(tag)
        pool.append({"tag": tag, "source": "competitor", "score": score, "sample_size": competitor_sample})
        added += 1
        if added >= COMPETITOR_TAGS:
            break
    return pool[:POOL_SIZE]

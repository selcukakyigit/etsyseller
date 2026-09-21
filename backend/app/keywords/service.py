import logging
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.etsy import listings as etsy_listings
from app.etsy import search as etsy_search
from app.etsy.client import EtsyClient
from app.listings.models import ListingStatSnapshot
from app.shops.models import Shop

logger = logging.getLogger(__name__)

OWN_TOP_N = 5
COMPETITOR_SAMPLE = 50
POOL_SIZE = 30


def _top_performing_tags(
    db: Session, shop: Shop, client: EtsyClient, taxonomy_id: int | None
) -> tuple[Counter, int]:
    """Tag frequency across the shop's own best-growing listings *in the same
    category* as the listing being edited, ranked by the views+favorites
    delta between their first and most recent daily snapshot (populated by
    jobs/daily_stats.py) — proven winners, not guesses.

    Filtering by taxonomy_id matters for shops selling across multiple,
    unrelated product lines (e.g. metal wall art AND digital stickers) —
    without it, a viral listing in one category pollutes every other
    category's keyword pool with irrelevant tags.

    Returns (tag -> how many of the matched own listings use it, how many
    own listings were actually matched) — the score's denominator.
    """
    snapshots = db.scalars(
        select(ListingStatSnapshot)
        .where(ListingStatSnapshot.shop_id == shop.id)
        .order_by(ListingStatSnapshot.captured_at.asc())
    ).all()

    by_listing: dict[int, list[ListingStatSnapshot]] = {}
    for row in snapshots:
        by_listing.setdefault(row.listing_id, []).append(row)

    growth: dict[int, int] = {}
    for listing_id, rows in by_listing.items():
        if len(rows) < 2:
            continue
        first, last = rows[0], rows[-1]
        growth[listing_id] = (last.views - first.views) + (last.favorites - first.favorites)

    # Consider more candidates than we need, since some will be filtered out
    # by category — then stop once we have enough same-category matches.
    candidate_ids = sorted(growth, key=lambda lid: growth[lid], reverse=True)[: OWN_TOP_N * 4]

    counts: Counter[str] = Counter()
    matched = 0
    for listing_id in candidate_ids:
        if matched >= OWN_TOP_N:
            break
        try:
            listing = etsy_listings.get_listing(client, listing_id)
        except Exception:
            logger.exception("Keyword pool: listing %s fetch failed, skipping", listing_id)
            continue
        if taxonomy_id and listing.get("taxonomy_id") != taxonomy_id:
            continue
        for tag in listing.get("tags") or []:
            counts[tag.lower()] += 1
        matched += 1
    return counts, matched


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
    """Own proven-winner tags + tags trending among top-ranked category
    listings, each scored by how many sampled listings actually use it (a
    free stand-in for "how competitive/popular is this keyword" — no extra
    Etsy request per keyword). Fed into the SEO prompt as candidates (Faz D)."""
    client = EtsyClient(db, shop)
    taxonomy_id = listing.get("taxonomy_id")
    own_counts, own_sample = _top_performing_tags(db, shop, client, taxonomy_id)
    competitor_counts, competitor_sample = _competitor_tags(taxonomy_id, _anchor_keywords(listing))

    pool: list[dict] = []
    seen: set[str] = set()

    # Own proven winners first — a tag your own best-growing listings use is
    # a stronger signal than one merely common among competitors.
    for tag, score in own_counts.most_common():
        if tag in seen:
            continue
        seen.add(tag)
        pool.append({"tag": tag, "source": "own", "score": score, "sample_size": own_sample})

    for tag, score in competitor_counts.most_common():
        if tag in seen:
            continue
        seen.add(tag)
        pool.append({"tag": tag, "source": "competitor", "score": score, "sample_size": competitor_sample})

    return pool[:POOL_SIZE]

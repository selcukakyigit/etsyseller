"""Keşfet ana ekranının zengin bölümleri: sezon takvimi, yükselenler/düşenler, fırsatlar, ülkelere göre Google talebi ve müşteri ülkeleri. Ekran ve sohbet asistanı AYNI
işlevi çağırır (CLAUDE.md). Kural: burada sağlayıcıya istek atılmaz ve iş kuyruğa alınmaz; yalnızca havuzdaki ölçümler ve mağazanın kendi siparişleri okunur
(ülke ölçümlerini haftalık toplu iş doldurur: bkz. service.refresh_markets). Havuz verisi GOOGLE verisidir, Etsy arama hacmi değildir; müşteri ülkeleri ise mağazanın gerçek siparişleridir."""
import datetime as dt
from dataclasses import asdict, dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.orders.models import OrderCache
from app.research import discover, exposure, policy, pool, service
from app.research.models import KeywordLink, KeywordTerm, ResearchJob
from app.research.providers import get_provider
from app.research.terms import researchable
from app.shops.models import Shop

OVERVIEW_TAGS = 30  # bölümlerin baktığı en sık etiket sayısı (ana ekrandaki çip listesinden geniştir)
CALENDAR_MAX = 8  # sezon takviminde gösterilen en çok etiket
MOVERS_MAX = 3  # yükselen ve düşen listelerinin her biri
MOVER_MIN_VOLUME = 50  # çok az aranan kelimede yüzde değişimi oynaktır; bunun altı yükselen/düşen sayılmaz
MOVER_MIN_CHANGE = 15  # % : bundan küçük değişim yön sayılmaz
OPPORTUNITIES_MAX = 6
OPPORTUNITY_MIN_VOLUME = 100
CUSTOMER_DAYS = 365
CUSTOMER_COUNTRIES_MAX = 60


@dataclass
class Overview:
    pulse: dict  # {"tags": n, "measured": n, "monthly_searches": n, "top_market": "US" | None, "next_peak": {term, in_months, peak_months} | None}
    calendar: list[dict] = field(default_factory=list)  # sezonluk etiketler: term, monthly[12], peak_months, in_months (yaklaşan zirveye kaç ay; ufukta yoksa None), volume
    movers: dict = field(default_factory=lambda: {"rising": [], "falling": []})  # her satır: term, volume, trend_pct, monthly, last_month, seasonal
    opportunities: list[dict] = field(default_factory=list)  # Item alanları: mağazanın kullanmadığı, talebi yüksek, kalabalık olmayan öneriler
    countries: dict = field(default_factory=dict)  # bkz. country_demand
    customers: dict = field(default_factory=dict)  # bkz. customer_countries

    def as_dict(self) -> dict:
        return asdict(self)


def _top_tags(db: Session, shop: Shop) -> list[str]:
    counts = discover._shop_tag_counts(db, shop)
    return [t for t, _ in counts.most_common() if researchable(t)][:OVERVIEW_TAGS]


def country_demand(db: Session, terms: list[str]) -> dict:
    """Etiketlerin ölçülen pazarlardaki toplam aylık Google araması (İngilizce sorgular). `rows`: pazar başına hacim, pay (%) ve en çok aranan etiket; hacme göre azalan.
    Tüm pazarlar tek sorguyla okunur. `preparing`: ülke ölçümü açık ve ana pazar dışında ya hiç ölçüm yok ya da bir ölçüm işi sırada/çalışıyor (küçük pazarlarda bazı kelimelerin
    hacmi hiç gelmeyebilir; bu yüzden "yarısı ölçülmedi" gibi kalıcı bir koşul kullanılmaz)."""
    default, language = service._market(None, None)
    enabled = bool(policy.get("research_map_enabled"))
    markets = [m for m in get_provider().markets if enabled or m == default]
    seeds = pool.find_terms(db, terms, language)
    by_id = {row.id: term for term, row in seeds.items()}
    latest = pool.latest_metrics_by_market(db, list(by_id), markets, language) if by_id else {}
    volumes: dict[str, dict[str, int]] = {m: {} for m in markets}
    for (keyword_id, market), metric in latest.items():
        if metric.search_volume is not None:
            volumes[market][by_id[keyword_id]] = metric.search_volume
    rows = []
    for market in markets:
        measured = volumes[market]
        top = max(measured, key=measured.get) if measured else None
        rows.append({"market": market, "volume": sum(measured.values()), "measured": len(measured), "top_term": top, "default": market == default})
    total = sum(r["volume"] for r in rows)
    for r in rows:
        r["share"] = round(r["volume"] / total * 100) if total else 0
    rows.sort(key=lambda r: (-r["volume"], r["market"]))
    working = db.scalar(select(func.count(ResearchJob.id)).where(ResearchJob.kind == "volume", ResearchJob.market != default, ResearchJob.status.in_(("queued", "running")))) or 0
    preparing = enabled and bool(terms) and (working > 0 or not any(r["measured"] for r in rows if not r["default"]))
    return {"enabled": enabled, "default_market": default, "tags": len(terms), "rows": rows, "preparing": preparing}


def customer_countries(db: Session, shop: Shop, today: dt.date | None = None) -> dict:
    """Mağazanın son yıldaki (iptal edilmemiş) siparişlerinin ülkelere dağılımı. Yalnızca BU mağazanın siparişleri: `shop` sahiplik denetiminden geçmiş olmalıdır."""
    since = dt.datetime.combine(today or dt.date.today(), dt.time.min) - dt.timedelta(days=CUSTOMER_DAYS)
    rows = db.execute(
        select(OrderCache.country_iso, func.count(OrderCache.id)).where(
            OrderCache.shop_id == shop.id, OrderCache.created_at >= since, OrderCache.is_canceled.is_(False), OrderCache.country_iso != "",
        ).group_by(OrderCache.country_iso).order_by(func.count(OrderCache.id).desc(), OrderCache.country_iso).limit(CUSTOMER_COUNTRIES_MAX)
    ).all()
    total = sum(n for _, n in rows)
    return {"days": CUSTOMER_DAYS, "orders": total, "rows": [{"country": c, "orders": int(n), "share": round(n / total * 100)} for c, n in rows]}


def _calendar(items: dict[str, discover.Item], seasons: dict, today: dt.date) -> list[dict]:
    out = []
    for term, view in seasons.items():
        if not view.seasonal or len(view.monthly) != 12:
            continue
        item = items.get(term)
        ahead = discover.months_until_peak(view.peak_months, today, horizon=11)
        out.append({"term": term, "monthly": view.monthly, "peak_months": view.peak_months, "in_months": ahead, "volume": item.volume if item else None})
    out.sort(key=lambda r: (r["in_months"] is None, r["in_months"] or 0, -(r["volume"] or 0)))
    return out[:CALENDAR_MAX]


def _movers(items: list[discover.Item], seasons: dict) -> dict:
    rows = [
        {"term": i.term, "volume": i.volume, "trend_pct": i.trend_pct, "monthly": i.monthly, "last_month": i.last_month, "seasonal": bool(seasons.get(i.term) and seasons[i.term].seasonal)}
        for i in items if i.trend_pct is not None and (i.volume or 0) >= MOVER_MIN_VOLUME
    ]
    rising = sorted((r for r in rows if r["trend_pct"] >= MOVER_MIN_CHANGE), key=lambda r: -r["trend_pct"])[:MOVERS_MAX]
    falling = sorted((r for r in rows if r["trend_pct"] <= -MOVER_MIN_CHANGE), key=lambda r: r["trend_pct"])[:MOVERS_MAX]
    return {"rising": rising, "falling": falling}


def _opportunities(db: Session, terms: list[str], mine: set[str], saved: set[str]) -> list[dict]:
    """Mağazanın etiketlerinin havuzdaki önerileri arasından, mağazada olmayan, çok aranan ve kalabalık olmayan kelimeler (hacme göre)."""
    _, language = service._market(None, None)
    seeds = pool.find_terms(db, terms, language)
    if not seeds:
        return []
    suggested = db.scalars(
        select(KeywordTerm).join(KeywordLink, KeywordLink.keyword_id == KeywordTerm.id)
        .where(KeywordLink.seed_id.in_([s.id for s in seeds.values()]), KeywordLink.relation == "suggestion", KeywordTerm.status != "blocked", KeywordTerm.language == language)
        .distinct()
    ).all()
    candidates = [k.term for k in suggested if k.term not in mine]
    views = {t: v for t, v in service.peek(db, candidates).items() if (v.search_volume or 0) >= OPPORTUNITY_MIN_VOLUME}
    crowd = exposure.counts(db, list(views))
    full = int(policy.get("research_crowd_full_shops"))
    items = [discover._item(t, v, crowd, full, mine, saved) for t, v in views.items()]
    items = [i for i in items if not i.crowded]
    items.sort(key=lambda i: -(i.volume or 0))
    return [vars(i) for i in items[:OPPORTUNITIES_MAX]]


def overview(db: Session, shop: Shop, today: dt.date | None = None) -> Overview:
    today = today or dt.date.today()
    terms = _top_tags(db, shop)
    counts = discover._shop_tag_counts(db, shop)
    mine = set(counts)
    views = service.peek(db, terms)
    seasons = service.season_cached(db, terms)
    crowd = exposure.counts(db, terms)
    full = int(policy.get("research_crowd_full_shops"))
    saved = discover._saved_terms(db, shop.workspace_id)
    items = {t: discover._item(t, views.get(t), crowd, full, mine, saved) for t in terms}
    calendar = _calendar(items, seasons, today)
    countries = country_demand(db, terms)
    measured = [i for i in items.values() if i.volume is not None]
    upcoming = next((c for c in calendar if c["in_months"] is not None), None)
    pulse = {
        "tags": sum(1 for t in counts if researchable(t)), "measured": len(measured), "monthly_searches": sum(i.volume or 0 for i in measured),
        "top_market": countries["rows"][0]["market"] if countries["rows"] and countries["rows"][0]["volume"] else None,
        "next_peak": {"term": upcoming["term"], "in_months": upcoming["in_months"], "peak_months": upcoming["peak_months"]} if upcoming else None,
    }
    return Overview(
        pulse=pulse, calendar=calendar, movers=_movers(list(items.values()), seasons), opportunities=_opportunities(db, terms, mine, saved), countries=countries,
        customers=customer_countries(db, shop, today),
    )

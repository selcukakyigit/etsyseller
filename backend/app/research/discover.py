"""Keşfet (kullanıcının araştırma ekranı) servisi. Ekran ve sohbet asistanı AYNI işlevleri çağırır (CLAUDE.md).

Kurallar: sağlayıcıya istek burada atılmaz (eksik veri `research.service.expand` ile kuyruğa girer). Kullanıcıya havuzdaki ölçümler SAYI olarak gösterilir
(aylık arama, CPC, reklam rekabeti, 12 aylık seri): bunlar GOOGLE verisidir, Etsy arama hacmi değildir ve arayüzde öyle etiketlenir. Platform içi sayılar
(kaç mağazaya önerildi gibi) yalnızca işaret olarak döner. Kaydedilen kelimeler kiracı verisidir (çalışma alanına bağlı)."""
import datetime as dt
import json
import time
from collections import Counter
from dataclasses import asdict, dataclass, field

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.dates import iso
from app.core.limits import SlidingWindow
from app.listings.models import ListingCache
from app.research import bands, exposure, policy, service
from app.research.models import SavedKeyword
from app.research.questions import is_question
from app.research.terms import normalize, researchable
from app.shops.models import Shop

MAX_RESULTS = 300  # bir aramada gösterilen en fazla öneri (sağlayıcıdan da bu kadar istenir)
QUESTIONS_MAX = 100  # soru listesi
ETSY_RESULTS_MAX = 20  # tek seferde Etsy ilan sayısı ölçülecek en fazla kelime (Etsy günlük kotası ortaktır)
MAX_SAVED = 2000  # çalışma alanı başına kaydedilebilecek en fazla kelime
MAX_COLLECTION_CHARS = 60
CROWDED_FROM = 0.5  # kalabalık oranı bunun üstündeyse "kalabalık" işareti (bkz. research/policy.py research_crowd_full_shops)
_INTENTS = frozenset({"informational", "navigational", "commercial", "transactional"})


@dataclass
class Item:
    term: str
    demand: str | None  # low | medium | high | None (henüz ölçülmedi); liste dışı yerlerin (editör) kullandığı kaba bant
    volume: int | None  # Google aylık arama (Etsy hacmi DEĞİL)
    cpc: float | None  # USD
    competition: int | None  # 0–100 Google Ads reklam rekabeti (Etsy organik rekabeti değil)
    monthly: list[int]  # son 12 ay (eskiden yeniye); trend çizgisi için
    last_month: str | None  # serinin son ayı "YYYY-AA" (ay adları buradan geriye sayılır)
    trend_pct: int | None  # son 3 ay ortalaması / ilk 3 ay ortalaması - 1 (%)
    intent: str | None
    crowded: bool
    mine: bool  # mağazanın listing'lerinde zaten etiket olarak var
    saved: bool


@dataclass
class SearchResult:
    seed: str
    status: str  # ready | pending | refused | empty | invalid
    refused: str | None = None  # budget | shop_daily | shop_searches | disabled | not_configured | market
    seed_item: Item | None = None
    items: list[Item] = field(default_factory=list)
    stale: bool = False  # sonuçlar eski; yenileniyor
    total_volume: int = 0  # listedeki kelimelerin toplam aylık araması
    season: dict | None = None  # tohum kelimenin mevsimsellik profili: {"monthly": [12], "peak_months": [..], "seasonal": bool, "pending": bool}
    mode: str = "all"  # all | questions
    measured_at: str | None = None  # listedeki ölçümlerin en yenisi (ISO); verinin ne zaman alındığını gösterir
    related_only: bool = False  # kelimenin kendi öneri listesi yok; liste, havuzda bu kelimeyi içeren ölçülmüş kelimelerdir

    def as_dict(self) -> dict:
        return asdict(self)


def clean_collection(name: str | None) -> str:
    return " ".join((name or "").split())[:MAX_COLLECTION_CHARS]


_TAGS_TTL = 300.0  # sn: "Sende var" işareti için etiketler; her aramada tüm listing JSON'u yeniden okunmasın
_tags_cache: dict[int, tuple[float, Counter]] = {}


def _shop_tag_counts(db: Session, shop: Shop) -> Counter:
    """Mağazanın etiketleri ve kaç listing'te kullanıldıkları (5 dk önbellekte)."""
    now = time.monotonic()
    hit = _tags_cache.get(shop.id)
    if hit and now - hit[0] < _TAGS_TTL:
        return hit[1]
    out: Counter = Counter()
    for (raw,) in db.execute(select(ListingCache.raw_json).where(ListingCache.shop_id == shop.id).execution_options(stream_results=True, yield_per=200)):
        try:
            out.update({normalize(str(t)) for t in json.loads(raw).get("tags") or []})  # listing başına bir kez
        except (ValueError, AttributeError):
            continue
    if len(_tags_cache) > 500:  # bellek sınırı: çok mağazada eskiler atılır
        _tags_cache.clear()
    _tags_cache[shop.id] = (now, out)
    return out


def _shop_tags(db: Session, shop: Shop) -> set[str]:
    return set(_shop_tag_counts(db, shop))


def _saved_terms(db: Session, workspace_id: int, collection: str | None = None) -> set[str]:
    q = select(SavedKeyword.term).where(SavedKeyword.workspace_id == workspace_id)
    if collection is not None:
        q = q.where(SavedKeyword.collection == collection)
    return {t for (t,) in db.execute(q)}


def trend_pct(monthly: list[int]) -> int | None:
    """Son 3 ayın ortalaması, ilk 3 ayınkine göre % değişim (12 aylık seride mevsim/yön göstergesi); yeterli veri ya da başlangıç yoksa None."""
    if len(monthly) < 6:
        return None
    first, last = sum(monthly[:3]) / 3, sum(monthly[-3:]) / 3
    return round((last - first) / first * 100) if first > 0 else None


def _item(term: str, metric: "service.MetricView | None", crowd: dict[str, int], full: int, mine: set[str], saved: set[str]) -> Item:
    intent = metric.intent if metric and metric.intent in _INTENTS else None
    monthly = metric.monthly if metric else []
    competition = metric.competition if metric else None
    return Item(
        term=term, demand=bands.demand_band(metric.search_volume) if metric else None, volume=metric.search_volume if metric else None,
        cpc=round(metric.cpc, 2) if metric and metric.cpc is not None else None, competition=None if competition is None else round(competition * 100),
        monthly=monthly, last_month=metric.last_month if metric and monthly else None, trend_pct=trend_pct(monthly), intent=intent,
        crowded=crowd.get(term, 0) / max(1, full) >= CROWDED_FROM, mine=term in mine, saved=term in saved,
    )


def season_of(db: Session, shop: Shop, term: str) -> dict | None:
    """Bir kelimenin mevsimsellik profili (havuzdan; yoksa iş kuyruğa alınır ve `pending` döner). Geçersiz kelimede None."""
    term = normalize(term)
    if not researchable(term):
        return None
    s = service.seasonality(db, term, shop_id=shop.id)
    return {"monthly": s.monthly, "peak_months": s.peak_months, "seasonal": s.seasonal, "pending": s.pending, "too_rare": s.too_rare, "min_volume": s.min_volume}


def search(db: Session, shop: Shop, seed: str, mode: str = "all", refresh: bool = False) -> SearchResult:
    """Tohum kelimenin önerileri (havuzdan); `mode="questions"`: yalnızca soru kalıpları (ayrı bir iş, yalnızca istenince çekilir).
    Havuzda yoksa/eskiyse araştırma işi kuyruğa alınır (`pending`); sonuç geldikçe aynı çağrı dolu döner."""
    term = normalize(seed)
    if not researchable(term):
        return SearchResult(seed=term, status="invalid")
    questions = mode == "questions"
    found = service.expand(db, term, shop_id=shop.id, limit=QUESTIONS_MAX if questions else MAX_RESULTS, questions=questions, force=refresh)
    # Soru listesinde yalnızca gerçek sorular gösterilir (sağlayıcı süzgecinin eski, yanlış kayıtlarına karşı da korur).
    terms = [t for t in found.metrics if not questions or is_question(t)][:MAX_RESULTS]
    own = service.peek(db, [term])
    related_only = False
    if not terms and not questions and own.get(term):  # kendi öneri listesi yok: başka aramalardan havuza girmiş, bu kelimeyi içeren ölçülmüş kelimeler gösterilir
        found.metrics = service.peek_containing(db, term, limit=MAX_RESULTS)
        terms, related_only = list(found.metrics), bool(found.metrics)
    if not terms and (questions or not own.get(term)):  # (soru sekmesi hariç) kelimenin kendi ölçümü havuzdaysa kartı gösterilir (öneri listesi hazır olmasa ya da hak dolsa da)
        status = "pending" if found.pending else "refused" if found.refused else "empty"
        return SearchResult(seed=term, status=status, refused=found.refused, mode=mode)
    crowd = exposure.counts(db, terms + [term])
    full = int(policy.get("research_crowd_full_shops"))
    mine, saved = _shop_tags(db, shop), _saved_terms(db, shop.workspace_id)
    items = [_item(t, found.metrics[t], crowd, full, mine, saved) for t in terms if t != term]
    season = None
    if not questions:  # mevsimsellik yalnızca tohum için (kelime başına ≈ 0,011 $, 90 gün önbellekte); ölçüm sürerken ekran yoklamaya devam eder
        season = season_of(db, shop, term)
    stale = bool(found.pending) or not all(m.fresh for m in found.metrics.values())
    return SearchResult(
        seed=term, status="ready", refused=found.refused, seed_item=_item(term, own.get(term), crowd, full, mine, saved), items=items,
        stale=(stale and bool(found.pending)) or bool(season and season["pending"]), season=season, related_only=related_only,
        total_volume=sum(i.volume or 0 for i in items), mode=mode,
        measured_at=iso(max((m.measured_at for m in list(found.metrics.values()) + list(own.values())), default=None)),
    )


def detail(db: Session, shop: Shop, term: str) -> tuple[Item, dict | None] | None:
    """Kelime ayrıntısı (ekranda kelimeye tıklayınca açılan pencere): havuzdaki ölçüm (12 aylık seri dahil) ve mevsimsellik profili.
    Kelime havuzda ölçülmemişse None (önce araştırılmalı). Mevsimsellik yoksa kuyruğa alınır (`pending`); sağlayıcıya istek atılmaz."""
    term = normalize(term)
    if not researchable(term):
        return None
    metric = service.peek(db, [term]).get(term)
    if metric is None:
        return None
    crowd = exposure.counts(db, [term])
    item = _item(term, metric, crowd, int(policy.get("research_crowd_full_shops")), _shop_tags(db, shop), _saved_terms(db, shop.workspace_id))
    return item, season_of(db, shop, term)


_etsy_limiter = SlidingWindow(limit=12, window=600)  # mağaza başına 10 dakikada en fazla 12 ölçüm (her biri en çok ETSY_RESULTS_MAX Etsy isteği)


def etsy_results(shop: Shop, terms: list[str]) -> dict[str, int | None] | None:
    """Kelimelerin Etsy'deki aktif ilan sayısı (rakip sayısı). Etsy günlük kotası ortak olduğundan mağaza başına sınırlıdır; sınır aşıldıysa None döner.
    Sonuçlar 6 saat önbellekte kalır (aynı kelime tekrar ölçülürse Etsy'ye gidilmez)."""
    from app.keywords import competition

    wanted = list(dict.fromkeys(t for t in (normalize(x) for x in terms) if researchable(t)))[:ETSY_RESULTS_MAX]
    if not wanted:
        return {}
    if not _etsy_limiter.hit(shop.id):
        return None
    return competition.result_counts(wanted)


# ---- Kaydedilenler (kiracı verisi)


@dataclass
class SavedView:
    collections: list[dict]  # [{"name": "", "count": 3}, …]
    collection: str
    items: list[Item]
    total: int


def _collection_counts(db: Session, workspace_id: int) -> list[tuple[str, int]]:
    return db.execute(
        select(SavedKeyword.collection, func.count()).where(SavedKeyword.workspace_id == workspace_id).group_by(SavedKeyword.collection).order_by(SavedKeyword.collection)
    ).all()


def saved(db: Session, shop: Shop, collection: str | None = None) -> SavedView:
    ws = shop.workspace_id
    counts = _collection_counts(db, ws)
    names = [c for c, _ in counts]
    current = clean_collection(collection) if collection is not None else (names[0] if names else "")
    rows = db.scalars(
        select(SavedKeyword).where(SavedKeyword.workspace_id == ws, SavedKeyword.collection == current).order_by(SavedKeyword.id.desc()).limit(MAX_SAVED)
    ).all()
    terms = [r.term for r in rows]
    metrics = service.peek(db, terms)
    crowd = exposure.counts(db, terms)
    full = int(policy.get("research_crowd_full_shops"))
    mine = _shop_tags(db, shop)
    return SavedView(
        collections=[{"name": c, "count": int(n)} for c, n in counts], collection=current,
        items=[_item(t, metrics.get(t), crowd, full, mine, set(terms)) for t in terms], total=len(terms),
    )


def save(db: Session, shop: Shop, user_id: int, terms: list[str], collection: str | None = None) -> int:
    """Kelimeleri koleksiyona ekler (zaten varsa atlanır); eklenen sayıyı döner. Çalışma alanı sınırı aşılmaz."""
    ws, name = shop.workspace_id, clean_collection(collection)
    wanted = list(dict.fromkeys(t for t in (normalize(x) for x in terms) if researchable(t)))
    if not wanted:
        return 0
    existing = {t for (t,) in db.execute(select(SavedKeyword.term).where(SavedKeyword.workspace_id == ws, SavedKeyword.collection == name, SavedKeyword.term.in_(wanted)))}
    room = MAX_SAVED - int(db.scalar(select(func.count()).select_from(SavedKeyword).where(SavedKeyword.workspace_id == ws)) or 0)
    new = [t for t in wanted if t not in existing][: max(0, room)]
    db.add_all(SavedKeyword(workspace_id=ws, term=t, collection=name, created_by=user_id, created_at=dt.datetime.utcnow()) for t in new)
    db.commit()
    if new:  # kelimelerin ölçümü ortak havuzdan gelsin: eksik olanlar kuyruğa girer (kaydetme bundan etkilenmez)
        try:
            service.volumes(db, new, shop_id=shop.id)
        except Exception:  # noqa: BLE001
            db.rollback()
    return len(new)


def unsave(db: Session, shop: Shop, terms: list[str], collection: str | None = None) -> int:
    wanted = [t for t in (normalize(x) for x in terms) if t]
    if not wanted:
        return 0
    res = db.execute(delete(SavedKeyword).where(
        SavedKeyword.workspace_id == shop.workspace_id, SavedKeyword.collection == clean_collection(collection), SavedKeyword.term.in_(wanted),
    ))
    db.commit()
    return int(res.rowcount or 0)


# ---- Ana ekran (arama yapılmadan önce): mağazanın kendi etiketlerinden başlangıç noktaları ve yaklaşan sezon

HOME_TAGS = 12  # ana ekranda gösterilen en sık kullanılan etiket sayısı
UPCOMING_MONTHS = 3  # "yaklaşan sezon": bugünden itibaren bu kadar ay içinde zirve yapanlar (bu ay dahil)
SEASON_FILL_PER_VISIT = 5  # ana ekran bir ziyarette en fazla bu kadar etiketin mevsimselliğini kuyruğa alır (kelime başına tek sefer, 90 gün önbellekte)


@dataclass
class Home:
    tags: list[Item]  # mağazanın en sık etiketleri (ölçümü varsa talep bilgisiyle)
    upcoming: list[dict]  # önümüzdeki aylarda zirve yapacak etiketler: Item alanları + in_months (0 = şimdi zirvede) + peak_months
    collections: list[dict]  # [{"name": "", "count": 3}, …]
    preparing: bool  # bazı etiketlerin mevsimselliği hesaplanıyor: ekran biraz sonra yeniden sorar


def months_until_peak(peak_months: list[int], today: dt.date, horizon: int = UPCOMING_MONTHS) -> int | None:
    """Bugünden kaç ay sonra zirve ayına girilir (0 = bu ay zirve); ufukta zirve yoksa None."""
    for offset in range(horizon + 1):
        if (today.month - 1 + offset) % 12 + 1 in peak_months:
            return offset
    return None


def home(db: Session, shop: Shop, today: dt.date | None = None) -> Home:
    """Boş Keşfet ekranı için mağazaya özel içerik. Havuzu yalnızca okur; tek istisna: ölçülmüş hacmi yeterli olup mevsimselliği hiç çekilmemiş en sık etiketler
    için mevsimsellik işi kuyruğa alınır (bütçe, tek-uçuş ve günlük iş sınırları geçerli; sonuç ekranda belirir). Ortak bir "herkesin aradığı" listesi YOKTUR:
    her mağazanın girişi kendi etiketlerinden gelir (aynı kelimelere koşuşmayı önler)."""
    today = today or dt.date.today()
    counts = _shop_tag_counts(db, shop)
    terms = [t for t, _ in counts.most_common() if researchable(t)][:HOME_TAGS]
    metrics = service.peek(db, terms)
    seasons = service.season_cached(db, terms)
    minimum = int(policy.get("research_season_min_volume"))
    preparing = False
    queued = 0
    for term in terms:  # en sık etiketten başlayarak; yalnızca ölçülmüş ve yeterince aranan, mevsimselliği hiç çekilmemiş olanlar
        m = metrics.get(term)
        if queued >= SEASON_FILL_PER_VISIT:
            break
        if term in seasons or m is None or (m.search_volume or 0) < minimum:
            continue
        view = service.seasonality(db, term, shop_id=shop.id)
        queued += 1
        preparing = preparing or view.pending
    crowd = exposure.counts(db, terms)
    full = int(policy.get("research_crowd_full_shops"))
    mine = set(counts)
    saved_terms = _saved_terms(db, shop.workspace_id)
    items = [_item(t, metrics.get(t), crowd, full, mine, saved_terms) for t in terms]
    upcoming = []
    for item in items:
        view = seasons.get(item.term)
        if view is None or not view.seasonal:
            continue
        ahead = months_until_peak(view.peak_months, today)
        if ahead is not None:
            upcoming.append({**vars(item), "in_months": ahead, "peak_months": view.peak_months})
    upcoming.sort(key=lambda u: (u["in_months"], -(u["volume"] or 0)))
    return Home(tags=items, upcoming=upcoming, collections=[{"name": c, "count": int(n)} for c, n in _collection_counts(db, shop.workspace_id)], preparing=preparing)

"""Keşfet (kullanıcının araştırma ekranı) servisi. Ekran ve sohbet asistanı AYNI işlevleri çağırır (CLAUDE.md).

Kurallar: sağlayıcıya istek burada atılmaz (eksik veri `research.service.expand` ile kuyruğa girer); kullanıcıya ham arama sayısı/CPC/mağaza sayısı
DÖNMEZ, yalnızca bant (düşük/orta/yüksek), niyet ve işaretler döner. Kaydedilen kelimeler kiracı verisidir (çalışma alanına bağlı); ölçümler gösterilirken
ortak havuzdan okunur."""
import datetime as dt
import json
import time
from dataclasses import asdict, dataclass, field

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.listings.models import ListingCache
from app.research import bands, exposure, policy, service
from app.research.models import SavedKeyword
from app.research.terms import normalize, researchable
from app.shops.models import Shop

MAX_RESULTS = 60  # bir aramada gösterilen en fazla öneri
MAX_SAVED = 2000  # çalışma alanı başına kaydedilebilecek en fazla kelime
MAX_COLLECTION_CHARS = 60
CROWDED_FROM = 0.5  # kalabalık oranı bunun üstündeyse "kalabalık" işareti (bkz. research/policy.py research_crowd_full_shops)
_INTENTS = frozenset({"informational", "navigational", "commercial", "transactional"})


@dataclass
class Item:
    term: str
    demand: str | None  # low | medium | high | None (henüz ölçülmedi)
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

    def as_dict(self) -> dict:
        return asdict(self)


def clean_collection(name: str | None) -> str:
    return " ".join((name or "").split())[:MAX_COLLECTION_CHARS]


_TAGS_TTL = 300.0  # sn: "Sende var" işareti için etiketler; her aramada tüm listing JSON'u yeniden okunmasın
_tags_cache: dict[int, tuple[float, set[str]]] = {}


def _shop_tags(db: Session, shop: Shop) -> set[str]:
    now = time.monotonic()
    hit = _tags_cache.get(shop.id)
    if hit and now - hit[0] < _TAGS_TTL:
        return hit[1]
    out: set[str] = set()
    for (raw,) in db.execute(select(ListingCache.raw_json).where(ListingCache.shop_id == shop.id).execution_options(stream_results=True, yield_per=200)):
        try:
            out.update(normalize(str(t)) for t in json.loads(raw).get("tags") or [])
        except (ValueError, AttributeError):
            continue
    if len(_tags_cache) > 500:  # bellek sınırı: çok mağazada eskiler atılır
        _tags_cache.clear()
    _tags_cache[shop.id] = (now, out)
    return out


def _saved_terms(db: Session, workspace_id: int, collection: str | None = None) -> set[str]:
    q = select(SavedKeyword.term).where(SavedKeyword.workspace_id == workspace_id)
    if collection is not None:
        q = q.where(SavedKeyword.collection == collection)
    return {t for (t,) in db.execute(q)}


def _item(term: str, metric: "service.MetricView | None", crowd: dict[str, int], full: int, mine: set[str], saved: set[str]) -> Item:
    intent = metric.intent if metric and metric.intent in _INTENTS else None
    return Item(
        term=term, demand=bands.demand_band(metric.search_volume) if metric else None, intent=intent,
        crowded=crowd.get(term, 0) / max(1, full) >= CROWDED_FROM, mine=term in mine, saved=term in saved,
    )


def search(db: Session, shop: Shop, seed: str) -> SearchResult:
    """Tohum kelimenin önerileri (havuzdan). Havuzda yoksa/eskiyse araştırma işi kuyruğa alınır (`pending`); sonuç geldikçe aynı çağrı dolu döner."""
    term = normalize(seed)
    if not researchable(term):
        return SearchResult(seed=term, status="invalid")
    found = service.expand(db, term, shop_id=shop.id)
    terms = list(found.metrics)[:MAX_RESULTS]
    own = service.peek(db, [term])
    if not terms and not own:
        status = "pending" if found.pending else "refused" if found.refused else "empty"
        return SearchResult(seed=term, status=status, refused=found.refused)
    crowd = exposure.counts(db, terms + [term])
    full = int(policy.get("research_crowd_full_shops"))
    mine, saved = _shop_tags(db, shop), _saved_terms(db, shop.workspace_id)
    items = [_item(t, found.metrics[t], crowd, full, mine, saved) for t in terms if t != term]
    stale = bool(found.pending) or not all(m.fresh for m in found.metrics.values())
    return SearchResult(
        seed=term, status="ready", refused=found.refused, seed_item=_item(term, own.get(term), crowd, full, mine, saved), items=items, stale=stale and bool(found.pending),
    )


# ---- Kaydedilenler (kiracı verisi)


@dataclass
class SavedView:
    collections: list[dict]  # [{"name": "", "count": 3}, …]
    collection: str
    items: list[Item]
    total: int


def saved(db: Session, shop: Shop, collection: str | None = None) -> SavedView:
    ws = shop.workspace_id
    counts = db.execute(
        select(SavedKeyword.collection, func.count()).where(SavedKeyword.workspace_id == ws).group_by(SavedKeyword.collection).order_by(SavedKeyword.collection)
    ).all()
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

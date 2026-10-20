"""Toplu işlemler için listing seçimi: tek, ortak filtre (asistan ve Listing'ler sayfası aynısını kullanır).
Yalnızca yerel önbellekten (Etsy'ye istek atmaz) ve yalnızca verilen mağazanın listing'lerinden seçer."""
import html
import json
import unicodedata
from collections import Counter
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.listings.models import ListingCache, ListingLocal
from app.shops.models import Shop

MAX_SELECTED = 500
MAX_LINE_CHARS = 1500  # arama sonucunda gösterilen bir satırın en çok karakteri
MAX_LINE_VARIANTS = 5  # aynı metnin en çok bu kadar farklı yazılış biçimi gösterilir


class ListingFilter(BaseModel):
    """Boş alan = o ölçüt uygulanmaz. Varsayılan durum yalnızca AKTİF listing'lerdir."""

    listing_ids: list[int] = Field(default_factory=list, max_length=MAX_SELECTED)
    title_contains: str | None = None
    tag_contains: str | None = None
    description_contains: str | None = None  # açıklamada BİREBİR geçen metin (büyük/küçük harf ve noktalama dahil; toplu bul-değiştirmeyle aynı eşleşme)
    shop_section_id: int | None = None
    taxonomy_id: int | None = None
    min_price: float | None = None
    max_price: float | None = None
    state: Literal["active", "inactive", "draft", "any"] = "active"
    listing_type: Literal["physical", "download"] | None = None

    def is_empty(self) -> bool:
        """Hiçbir daraltıcı ölçüt yok (yalnızca durum): tüm mağaza anlamına gelir; çağıran bunu bilerek kullanmalı."""
        return not (self.listing_ids or self.title_contains or self.tag_contains or self.description_contains or self.shop_section_id or self.taxonomy_id or self.min_price is not None or self.max_price is not None or self.listing_type)


def _norm_text(text: str) -> str:
    return html.unescape(text or "").replace("\r\n", "\n")


def loose(text: str) -> str:
    """Gevşek karşılaştırma biçimi: büyük/küçük harf, fazla boşluk ve tipografik tırnak farkları yok sayılır."""
    t = unicodedata.normalize("NFKC", _norm_text(text)).casefold()
    for fancy, plain in (("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"')):
        t = t.replace(fancy, plain)
    return " ".join(t.split())


def _local_descriptions(db: Session, shop: Shop) -> dict[int, str | None]:
    """Yerel (yayınlanmamış) sürümü olan listing'lerin açıklaması: kullanıcı güncel hâli görür, arama da ondan yapılır."""
    return {loc.listing_id: json.loads(loc.data_json).get("description") for loc in db.scalars(select(ListingLocal).where(ListingLocal.shop_id == shop.id))}


def _current_description(raw: dict, local: dict[int, str | None], listing_id: int) -> str:
    return _norm_text(local[listing_id] if local.get(listing_id) is not None else raw.get("description"))


def _min_price(raw: dict) -> float | None:
    p = raw.get("price") or {}
    return p["amount"] / p["divisor"] if p.get("divisor") else None


def select_rows(db: Session, shop: Shop, f: ListingFilter, limit: int = MAX_SELECTED) -> list[ListingCache]:
    q = select(ListingCache).where(ListingCache.shop_id == shop.id)
    if f.listing_ids:
        q = q.where(ListingCache.listing_id.in_(f.listing_ids))
    if f.title_contains:
        q = q.where(ListingCache.title.like(f"%{f.title_contains.strip()}%"))
    out: list[ListingCache] = []
    needle = (f.title_contains or "").strip().lower()
    tag = (f.tag_contains or "").strip().lower()
    wanted = _norm_text(f.description_contains) if f.description_contains else ""
    local_descriptions = _local_descriptions(db, shop) if wanted else {}  # açıklama güncel hâlden (yerel sürüm varsa o) aranır
    for row in db.scalars(q.order_by(ListingCache.listing_id)).all():
        raw = json.loads(row.raw_json)
        if f.state != "any" and raw.get("state") != f.state:
            continue
        if needle and needle not in html.unescape(row.title or "").lower():  # başlıktaki &amp; gibi kaçışlar yüzünden SQL eşleşmesi kaçırmış olabilir
            continue
        if tag and not any(tag in str(t).lower() for t in raw.get("tags") or []):
            continue
        if wanted and wanted not in _current_description(raw, local_descriptions, row.listing_id):
            continue
        if f.shop_section_id and raw.get("shop_section_id") != f.shop_section_id:
            continue
        if f.taxonomy_id and raw.get("taxonomy_id") != f.taxonomy_id:
            continue
        if f.listing_type and (raw.get("listing_type") == "download") != (f.listing_type == "download"):
            continue
        price = _min_price(raw)
        if f.min_price is not None and (price is None or price < f.min_price):
            continue
        if f.max_price is not None and (price is None or price > f.max_price):
            continue
        out.append(row)
        if len(out) >= limit:
            break
    return out


def description_search(db: Session, shop: Shop, phrase: str, state: str = "any", title: str | None = None) -> dict:
    """Açıklamada metin arar; birebir sonuç yoksa kendiliğinden gevşetir: önce büyük/küçük harf ve boşluk farkını yok sayar, sonra metnin sondaki
    kelimelerini birer birer atar ("☛☛☛Font Style YAZIsı" → "☛☛☛Font Style"). Döner: kullanılan arama, birebir mi, eşleşen listing'ler ve eşleşen satırın farklı yazılış biçimleri (tam metin + kaç listing'de).
    Toplu bul-değiştirme birebir eşleşme kullanır; bu yüzden örnek satırlar, değiştirilecek tam metni bulmak içindir."""
    rows = select_rows(db, shop, ListingFilter(title_contains=title, state=state))  # type: ignore[arg-type]
    local = _local_descriptions(db, shop)
    texts = [(row, _current_description(json.loads(row.raw_json), local, row.listing_id)) for row in rows]
    loose_texts: list[str] | None = None
    words = phrase.split()
    candidates: list[tuple[str, bool]] = [(phrase, False), (phrase, True)]
    for k in range(len(words) - 1, 0, -1):
        part = " ".join(words[:k])
        if len(part) >= 4:  # bir iki harflik parça her şeyi bulur
            candidates += [(part, False), (part, True)]
    for needle, relaxed in candidates:
        if relaxed and loose_texts is None:
            loose_texts = [loose(text) for _, text in texts]
        wanted = loose(needle) if relaxed else _norm_text(needle)
        haystacks = loose_texts if relaxed else [text for _, text in texts]
        hits = [i for i, hay in enumerate(haystacks) if wanted in hay]
        if not hits:
            continue
        # Eşleşen satırın TAM hâli, farklı yazılış varyantlarıyla ve kaç listing'de geçtikleriyle (kullanıcı tam metni görüp düzenler; toplu değiştirme birebir bu satırla çalışır)
        counts: Counter[str] = Counter()
        for i in hits:
            for line in texts[i][1].split("\n"):
                if wanted in (loose(line) if relaxed else line):
                    counts[line.strip()[:MAX_LINE_CHARS]] += 1
                    break
        lines = [{"line": text, "count": n} for text, n in counts.most_common(MAX_LINE_VARIANTS)]
        if loose_texts is None:
            loose_texts = [loose(text) for _, text in texts]
        loose_total = sum(1 for hay in loose_texts if loose(needle) in hay)  # büyük/küçük harf ve tırnak farkıyla yazılmış olanlar da dahil
        return {"phrase": needle, "exact": needle == phrase and not relaxed, "rows": [texts[i][0] for i in hits], "lines": lines, "loose_total": loose_total}
    return {"phrase": phrase, "exact": True, "rows": [], "lines": [], "loose_total": 0}

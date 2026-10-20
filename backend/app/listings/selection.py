"""Toplu işlemler için listing seçimi: tek, ortak filtre (asistan ve Listing'ler sayfası aynısını kullanır).
Yalnızca yerel önbellekten (Etsy'ye istek atmaz) ve yalnızca verilen mağazanın listing'lerinden seçer."""
import html
import json
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.listings.models import ListingCache, ListingLocal
from app.shops.models import Shop

MAX_SELECTED = 500


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
    # Açıklama, kullanıcının gördüğü güncel hâlden aranır: yerel sürüm (yayınlanmamış değişiklik) varsa o, yoksa Etsy'deki.
    local_descriptions = {
        loc.listing_id: json.loads(loc.data_json).get("description") for loc in db.scalars(select(ListingLocal).where(ListingLocal.shop_id == shop.id))
    } if wanted else {}
    for row in db.scalars(q.order_by(ListingCache.listing_id)).all():
        raw = json.loads(row.raw_json)
        if f.state != "any" and raw.get("state") != f.state:
            continue
        if needle and needle not in html.unescape(row.title or "").lower():  # başlıktaki &amp; gibi kaçışlar yüzünden SQL eşleşmesi kaçırmış olabilir
            continue
        if tag and not any(tag in str(t).lower() for t in raw.get("tags") or []):
            continue
        if wanted:
            description = local_descriptions[row.listing_id] if local_descriptions.get(row.listing_id) is not None else raw.get("description")
            if wanted not in _norm_text(description):
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

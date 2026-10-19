"""Yeni listing için mağazanın kendi alışkanlıklarından öğrenilen varsayılanlar (yalnızca yerel önbellek; Etsy'ye istek atmaz).

Etsy'nin "yeni listing"i de mağazanın diğer listing'lerine bakarak önceden doldurur: işlem profili, mağaza bölümü, üretim ortağı, kim yaptı,
yenileme. Asistan taslağı da aynısını yapar; kullanıcıya bu alanlar için soru sorulmaz. Aynı kategoride listing varsa onlar esas alınır."""
import json
import re
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.listings import dimensions
from app.listings.models import ListingCache
from app.shops import reference_cache
from app.shops.models import Shop

_STOP = {"the", "and", "for", "with", "custom", "personalized", "gift", "gifts", "sign", "signs", "set", "decor", "wall", "art", "home", "shop", "new"}
_WORD = re.compile(r"[a-zçğıöşü]+")


def _words(text: str) -> set[str]:
    return {w.rstrip("s") for w in _WORD.findall(str(text).lower()) if len(w) > 2 and w not in _STOP}


def _top(counter: Counter):
    return counter.most_common(1)[0][0] if counter else None


def _readiness(inventory_json: str | None) -> int | None:
    for p in json.loads(inventory_json or "{}").get("products", []):
        for o in p.get("offerings", []):
            if o.get("readiness_state_id"):
                return int(o["readiness_state_id"])
    return None


def _section_by_title(db: Session, shop_id: int, title: str) -> int | None:
    """Kategoride eşleşme yoksa: bölüm adındaki sözcükler ürün başlığında geçiyorsa (ör. "Metal Garage Sign" bölümü, "garage sign" ürünü). Belirsizse seçmez."""
    want = _words(title)
    scored = []
    for s in reference_cache.peek(db, shop_id, "sections") or []:
        sid, name = s.get("shop_section_id"), _words(s.get("title") or "")
        if sid and name:
            scored.append((len(name & want) / len(name), sid))
    scored.sort(reverse=True)
    if scored and scored[0][0] >= 0.5 and (len(scored) == 1 or scored[0][0] > scored[1][0]):
        return int(scored[0][1])
    return None


def size_unit(db: Session, shop: Shop, currency: str = "USD") -> str:
    """Mağazanın ölçü birimi alışkanlığı (mevcut ölçü varyasyonlarından; yoksa USD → inç, diğerleri cm)."""
    option_lists: list[list[str]] = []
    for (inv_json,) in db.execute(select(ListingCache.inventory_json).where(ListingCache.shop_id == shop.id).limit(200)):
        by_prop: dict[str, list[str]] = {}
        for p in json.loads(inv_json or "{}").get("products", []):
            for pv in p.get("property_values", []):
                by_prop.setdefault(str(pv.get("property_name")), []).extend(str(v) for v in pv.get("values") or [])
        option_lists.extend(by_prop.values())
    return dimensions.shop_unit(option_lists, currency)


def learn(db: Session, shop: Shop, taxonomy_id: int | None, title: str = "") -> dict:
    """{readiness_state_id, shop_section_id, production_partner_ids, who_made, when_made, is_supply, should_auto_renew, depth, kaynak}.
    Bilinmeyen alan None/boş kalır (uydurulmaz)."""
    rows = db.execute(select(ListingCache.raw_json, ListingCache.inventory_json, ListingCache.properties_json).where(ListingCache.shop_id == shop.id)).all()
    ready_all, ready_cat = Counter(), Counter()
    partners_all, partners_cat = Counter(), Counter()
    sections_cat = Counter()
    made_all, renew_all = Counter(), Counter()
    depth_cat = Counter()
    cohort = 0
    for raw_json, inv_json, props_json in rows:
        raw = json.loads(raw_json)
        if raw.get("state") not in ("active", "draft", "inactive", "expired"):
            continue
        same = bool(taxonomy_id) and raw.get("taxonomy_id") == taxonomy_id
        cohort += same
        ready = _readiness(inv_json)
        partners = tuple(sorted(raw.get("production_partner_ids") or [p.get("production_partner_id") for p in raw.get("production_partners") or [] if p.get("production_partner_id")]))
        for counter, value in ((ready_all, ready),) + (((ready_cat, ready),) if same else ()):
            if value:
                counter[value] += 1
        for counter in (partners_all,) + ((partners_cat,) if same else ()):
            counter[partners] += 1
        if same and raw.get("shop_section_id"):
            sections_cat[int(raw["shop_section_id"])] += 1
        made_all[(raw.get("who_made"), raw.get("when_made"), bool(raw.get("is_supply")))] += 1
        renew_all[bool(raw.get("should_auto_renew"))] += 1
        if same:
            for p in json.loads(props_json or "[]"):
                if str(p.get("property_name", "")).lower() == "depth" and p.get("values"):
                    depth_cat[(str(p["values"][0]), p.get("scale_id"))] += 1
    made = _top(made_all) or (None, None, False)
    section = _top(sections_cat) or _section_by_title(db, shop.id, title)
    depth = _top(depth_cat)
    return {
        "readiness_state_id": _top(ready_cat) or _top(ready_all),
        "shop_section_id": section,
        "production_partner_ids": list(_top(partners_cat) or _top(partners_all) or ()),
        "who_made": made[0], "when_made": made[1], "is_supply": made[2],
        "should_auto_renew": _top(renew_all),
        "depth": {"value": depth[0], "scale_id": depth[1]} if depth else None,
        "ayni_kategoride_listing": cohort,
    }

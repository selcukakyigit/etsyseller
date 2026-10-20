"""Listing alanlarındaki DEĞERLERİN analizi (salt okunur): bir değer kaç listing'de var, kaç farklı yazılışı var. Kişiselleştirme soruları, varyasyon
adları/seçenekleri, özellikler, etiketler ve malzemeler için. Düzenlemez; toplu düzenlemeden önce "neyi değiştireceğiz" sorusunu cevaplar.

Kaynak, kullanıcının gördüğü güncel hâldir: yerel (yayınlanmamış) sürüm varsa o, yoksa Etsy'nin önbellekteki hâli (toplu işlem motoruyla aynı çalışma kopyası)."""
import json
from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.listings import bulk, inventory_edit
from app.listings.models import ListingLocal
from app.listings.selection import ListingFilter, loose, select_rows
from app.shops.models import Shop

FIELDS = ("personalization_question", "personalization_option", "variation_name", "variation_option", "attribute", "tag", "material")
MAX_GROUPS = 40
SAMPLES = 3


def _values(work: dict, field: str) -> list[str] | None:
    """Çalışma kopyasındaki o alanın değerleri; veri yoksa None (kişiselleştirme henüz eşitlenmemiş olabilir)."""
    if field in ("personalization_question", "personalization_option"):
        personalization = work.get("personalization")
        if personalization is None:
            return None
        questions = personalization.get("questions") or []
        if field == "personalization_question":
            return [q.get("question_text") or "" for q in questions]
        return [str(o.get("label") if isinstance(o, dict) else o) for q in questions for o in q.get("options") or []]
    if field == "variation_name":
        return inventory_edit.variation_names(work)
    if field == "variation_option":
        return [f"{name}: {value}" for name in inventory_edit.variation_names(work) for value in inventory_edit.options(work, name)]
    if field == "attribute":
        return [f"{p.get('property_name')}: {v}" for p in work.get("properties") or [] for v in p.get("values") or []]
    if field == "tag":
        return list(work.get("tags") or [])
    return list(work.get("materials") or [])


def analyze(db: Session, shop: Shop, field: str, contains: str | None = None, state: str = "any", limit: int = 20) -> dict:
    """Alan değerlerini gruplar: gevşek anahtar (büyük/küçük harf, boşluk, tırnak farkı yok sayılır) altında farklı yazılışları ve listing sayılarını verir."""
    if field not in FIELDS:
        raise ValueError(f"field {', '.join(FIELDS)} olmalı.")
    rows = select_rows(db, shop, ListingFilter(state=state))  # type: ignore[arg-type]
    local = {r.listing_id: json.loads(r.data_json) for r in db.scalars(select(ListingLocal).where(ListingLocal.shop_id == shop.id))}
    needle = loose(contains) if contains else ""
    spellings: dict[str, Counter] = defaultdict(Counter)  # gevşek anahtar -> yazılış -> listing sayısı
    listings: dict[str, list[dict]] = defaultdict(list)
    unavailable = 0
    for row in rows:
        work = local.get(row.listing_id) or bulk.snapshot_cached(row)
        values = _values(work, field)
        if values is None:
            unavailable += 1
            continue
        for value in {v for v in values if v}:  # aynı listing'de aynı değer birden çok geçse de bir sayılır
            key = loose(value)
            if needle and needle not in key:
                continue
            spellings[key][value] += 1
            if len(listings[key]) < SAMPLES:
                listings[key].append({"listing_id": row.listing_id, "baslik": (row.title or "")[:70]})
    groups = []
    for key, counter in spellings.items():
        groups.append({
            "deger": counter.most_common(1)[0][0], "listing_sayisi": sum(counter.values()),
            "yazilislar": [{"yazilis": text, "listing_sayisi": n} for text, n in counter.most_common()] if len(counter) > 1 else None,
            "ornek": listings[key],
        })
    groups.sort(key=lambda g: -g["listing_sayisi"])
    hint = {"ipucu": "Bu alanda bulunamadı. Aranan bir yazı/cümleyse açıklamada olabilir: search_listings description_contains ile açıklamada ara."} if contains and not groups else {}
    return {**hint,
        "alan": field, "incelenen_listing": len(rows), "veri_olmayan_listing": unavailable, "farkli_deger": len(groups), "degerler": groups[: max(1, min(limit, MAX_GROUPS))],
    }

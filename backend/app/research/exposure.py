"""Kalabalık sayacı (çeşitlilik): aynı ifade çok sayıda mağazaya önerilirse herkes aynı kelimeyle yarışır. Öneriler `listing_versions`'a yazıldığı için
sayı oradan, FARKLI MAĞAZA olarak hesaplanır ve yalnızca (ifade, sayı) olarak ortak tabloya yazılır; mağaza kimliği hiçbir zaman havuza girmez."""
import datetime as dt
import json
import logging

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.listings.models import ListingVersion
from app.research import policy
from app.research.models import SuggestionExposure
from app.research.terms import normalize

log = logging.getLogger(__name__)
CHUNK = 500


def rebuild(db: Session) -> int:
    """Tabloyu son `research_crowd_window_days` günün önerilerinden baştan kurar; yazılan ifade sayısını döner."""
    since = dt.datetime.utcnow() - dt.timedelta(days=int(policy.get("research_crowd_window_days")))
    shops: dict[str, set[int]] = {}
    for shop_id, raw in db.execute(
        select(ListingVersion.shop_id, ListingVersion.suggested_tags).where(ListingVersion.kind == "ai_suggestion", ListingVersion.created_at >= since)
    ):
        try:
            tags = json.loads(raw or "[]")
        except json.JSONDecodeError:
            continue
        for tag in tags:
            term = normalize(str(tag))
            if term:
                shops.setdefault(term[:120], set()).add(shop_id)
    now = dt.datetime.utcnow()
    db.execute(delete(SuggestionExposure))
    db.add_all(SuggestionExposure(term=t, shops=len(s), computed_at=now) for t, s in shops.items())
    db.commit()
    return len(shops)


def counts(db: Session, terms: list[str]) -> dict[str, int]:
    """normalize edilmiş ifade -> kaç farklı mağazaya önerildi (hiç önerilmemişler dönmez)."""
    wanted = list({normalize(t)[:120] for t in terms if normalize(t)})
    out: dict[str, int] = {}
    for i in range(0, len(wanted), CHUNK):
        for row in db.scalars(select(SuggestionExposure).where(SuggestionExposure.term.in_(wanted[i : i + CHUNK]))):
            out[row.term] = row.shops
    return out

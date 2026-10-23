"""Öneri kalitesi: önerilen etiketler gerçekten işe yarıyor mu? Ölçümü yeniden yazmayız; `insights/impact.py` her yapay zekâ destekli yayın için kontrol gruplu
önce/sonra ölçümü zaten yapıp `ListingChange.result_json`a yazıyor. Burada o sonuçlar ifade bazında (farklı mağaza sayısıyla) toplanır; yalnızca sayı saklanır."""
import json
import logging
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.listings.models import ListingChange
from app.research.models import PhraseOutcome
from app.research.terms import normalize

log = logging.getLogger(__name__)
VERDICTS = ("better", "worse", "same", "unclear", "low_data")
CHUNK = 500


@dataclass
class Outcome:
    applied: int
    measured: int
    better: int
    worse: int
    same: int
    unclear: int
    low_data: int


def rebuild(db: Session) -> int:
    """Tabloyu tüm yapay zekâ destekli etiket değişikliklerinden baştan kurar; yazılan ifade sayısını döner. Yalnızca KESİNLEŞMİŞ (`final`) ölçümler
    karar sayılır: sonradan değişebilecek ara sonuç sayıya girmez."""
    applied: dict[str, set[int]] = {}
    measured: dict[str, dict[str, set[int]]] = {}
    for shop_id, details_raw, result_raw in db.execute(
        select(ListingChange.shop_id, ListingChange.details, ListingChange.result_json).where(ListingChange.source == "ai", ListingChange.fields.like('%"tags"%'))
    ):
        try:
            added = json.loads(details_raw or "{}").get("tags_added") or []
            result = json.loads(result_raw) if result_raw else {}
        except json.JSONDecodeError:
            continue
        verdict = result.get("verdict") if result.get("final") and result.get("status") == "measured" else None
        for tag in added:
            term = normalize(str(tag))[:120]
            if not term:
                continue
            applied.setdefault(term, set()).add(shop_id)
            if verdict in VERDICTS:
                measured.setdefault(term, {}).setdefault(verdict, set()).add(shop_id)
    db.execute(delete(PhraseOutcome))
    rows = []
    for term, shops in applied.items():
        by = measured.get(term, {})
        rows.append(PhraseOutcome(
            term=term, applied=len(shops), measured=len(set().union(*by.values())) if by else 0,
            **{v: len(by.get(v, ())) for v in VERDICTS},
        ))
    db.add_all(rows)
    db.commit()
    return len(rows)


def for_term(db: Session, term: str) -> Outcome | None:
    row = db.get(PhraseOutcome, normalize(term)[:120])
    if row is None:
        return None
    return Outcome(row.applied, row.measured, row.better, row.worse, row.same, row.unclear, row.low_data)

"""Düğmeli onay: geri dönüşü zor işlerde (şimdilik YENİ TASLAKLARI silme) model işi YAPMAZ. Araç yalnızca bir onay kartı üretir (`confirm_action`, [Sil] [Vazgeç]);
işi kullanıcının düğmeye basması tetikler (`POST …/assistant/actions/{id}/confirm`). Böylece model "onaylandı" sayıp kendi kendine silemez, "sildim" diyemez.

Eylemler mağazaya aittir, 30 dakika sonra geçersiz olur; ikinci tıklama etkisizdir. Bellekte tutulur (tek süreç; bkz. listings/rewrite.py). Yeni bir tür eklemek için
`HANDLERS`a bir işlev yazılır; işlev yetkiyi ve sahipliği KENDİ doğrular (düğme isteği dışarıdan gelir)."""
import threading
import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.listings import bulk, drafts
from app.shops.models import Shop

TTL_SECONDS = 30 * 60
MAX_DELETE = 50


@dataclass
class Action:
    shop_id: int
    kind: str
    payload: dict
    items: list[dict]  # kartta gösterilen satırlar: [{"listing_id", "title"}]
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "pending"  # pending → done | cancelled | expired
    result: dict = field(default_factory=dict)
    created: float = field(default_factory=time.time)


_ACTIONS: dict[str, Action] = {}
_lock = threading.Lock()


def create(shop_id: int, kind: str, payload: dict, items: list[dict]) -> Action:
    now = time.time()
    with _lock:
        for aid in [k for k, a in _ACTIONS.items() if now - a.created > 6 * TTL_SECONDS]:
            del _ACTIONS[aid]
        action = Action(shop_id, kind, payload, items)
        _ACTIONS[action.id] = action
    return action


def get(action_id: str, shop_id: int) -> Action | None:
    """Eylem yalnızca kendi mağazasına aittir; başka mağazanınki bulunamaz sayılır."""
    action = _ACTIONS.get(action_id)
    if action is None or action.shop_id != shop_id:
        return None
    if action.status == "pending" and time.time() - action.created > TTL_SECONDS:
        action.status = "expired"
    return action


def public(action: Action) -> dict:
    return {"action_id": action.id, "kind": action.kind, "status": action.status, "items": action.items, "result": action.result}


def cancel(action: Action) -> None:
    with _lock:
        if action.status == "pending":
            action.status = "cancelled"


def confirm(db: Session, shop: Shop, action: Action) -> dict:
    """Kullanıcı [Onayla]ya bastı: eylem bir kez çalışır. Bekleyen değilse (zaten yapıldı/vazgeçildi/süresi doldu) hiçbir şey yapılmaz."""
    with _lock:
        if action.status != "pending":
            return public(action)
        action.status = "done"  # ikinci tıklama aynı işi yeniden yapmasın
    action.result = HANDLERS[action.kind](db, shop, action.payload)
    return public(action)


def _delete_drafts(db: Session, shop: Shop, payload: dict) -> dict:
    """Yalnızca henüz Etsy'ye gitmemiş yeni taslaklar (kimliği negatif) ve bu mağazanın kendi taslakları silinir; yayında olan listing'e asla dokunulmaz."""
    deleted, skipped = [], []
    for lid in payload["listing_ids"][:MAX_DELETE]:
        if not isinstance(lid, int) or lid >= 0 or not (drafts._local_row(db, shop, lid) is not None or drafts._row(db, shop, lid) is not None):
            skipped.append(lid)
            continue
        bulk.delete_listing(db, shop, lid)
        deleted.append(lid)
    return {"deleted": deleted, "skipped": skipped}


HANDLERS = {"delete_drafts": _delete_drafts}


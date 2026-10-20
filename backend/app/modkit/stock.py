"""Stok defteri: malzeme kaleminin miktarı, kalemin BİRİMİNDE tutulan hareketlerin toplamıdır (`StockMovement`); elle yazılan bir "mevcut miktar" yoktur,
bu yüzden her değişikliğin sebebi ve geçmişi bellidir. Her modül kullanır (bugün Dış Tedarik): iş onaylanınca satır miktarları `consume` ile düşer,
yeniden açılınca `revert_ref` geri alır.

Maliyet ağırlıklı ortalamadır: alım ödenen tutarla girer, çıkış (kullanım, sayım farkı) o anki ortalamayla değerlenir ve çıkış satırına anlık kopya olarak
yazılır (sonraki fiyat değişimi eski kullanımı bozmaz). Stok sıfıra ya da altına inince ortalama bir sonraki alımla yeniden başlar.

Alım girişinde miktar kalemin biriminde ya da "paket" (kalemin `pack_size`'ı) olarak, aynı boyuttaki başka bir birimde (kg ↔ ton) ya da plaka kalemlerinde
tabaka ↔ kg olarak yazılabilir; hepsi kalemin birimine çevrilip öyle kaydedilir. Tutar toplam olarak girilince birim fiyat bölünerek bulunur."""
import datetime as dt

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.i18n import tr
from app.modkit import materials, pricing, units
from app.modkit.access import EntityAccess
from app.modkit.models import PriceItem, StockMovement

KINDS = ("opening", "purchase", "use", "adjust")
TRACKING_FIELDS = ("track_stock", "min_stock", "pack_size")  # kalemin stok ayarları (`clean_tracking`)
MAX_QTY = 1e9
EPS = 1e-9
PACK = "pack"  # giriş birimi: paket (kalemin `pack_size`'ı)
LOW_SHARE = 0.1  # en az stok girilmemişse: son alımdaki miktarın %10'u altı "azaldı"


# ------------------------------------------------------------------ kalem ayarları ----

def clean_tracking(access: EntityAccess, kind: str, data: dict) -> dict:
    """Kalemin stok ayarlarını doğrular (`track_stock`, `min_stock`, `pack_size`); yalnızca verilenler döner, None = boşalt. Yalnızca çalışma alanı
    üyesi koyabilir (stok iç bilgidir) ve yalnızca malzeme kalemlerinde anlamlıdır (başka kalemde yok sayılır)."""
    if not data or kind != "material":
        return {}
    access.require_member()
    out: dict = {}
    if "track_stock" in data:
        out["track_stock"] = bool(data["track_stock"])
    for key in ("min_stock", "pack_size"):
        if key not in data:
            continue
        value = data[key]
        if value is None:
            out[key] = None
        elif (key == "min_stock" and 0 <= float(value) <= MAX_QTY) or (key == "pack_size" and 0 < float(value) <= MAX_QTY):
            out[key] = round(float(value), 6)
        else:
            raise HTTPException(422, tr("Geçersiz miktar", "Invalid quantity"))
    return out


# ------------------------------------------------------------------ hesap ----

def _movements(db: Session, item_ids: list[int]) -> dict[int, list[StockMovement]]:
    out: dict[int, list[StockMovement]] = {i: [] for i in item_ids}
    if item_ids:
        for m in db.scalars(select(StockMovement).where(StockMovement.item_id.in_(item_ids)).order_by(StockMovement.moved_on, StockMovement.id)):
            out[m.item_id].append(m)
    return out


def replay(rows: list[StockMovement], fallback_cost: float | None) -> tuple[float, float | None, float]:
    """Hareketleri sırayla işler: (eldeki miktar, ağırlıklı ortalama maliyet, referans miktar). Referans: son alımdan hemen sonraki miktar (göstergenin
    "tam dolu" noktası). Maliyeti girilmemiş alım (ya da ilk kayıt) o ana kadarki ortalamayla, o da yoksa `fallback_cost` (fiyat listesi) ile değerlenir."""
    qty = value = 0.0
    ref = 0.0
    for r in rows:
        if r.kind in ("opening", "purchase") and r.qty > 0:
            if qty <= EPS:
                qty = value = 0.0  # bitmiş stok: ortalama yeniden başlar
            cost = r.unit_cost if r.unit_cost is not None else (value / qty if qty > EPS else (fallback_cost or 0.0))
            qty += r.qty
            value += r.qty * cost
            ref = qty
        else:  # çıkış ya da sayım farkı: o anki ortalamayla
            avg = value / qty if qty > EPS else (fallback_cost or 0.0)
            qty += r.qty
            value += r.qty * avg
            if qty <= EPS:
                value = 0.0
    return qty, (value / qty if qty > EPS else fallback_cost), max(ref, qty)


def level(item: PriceItem, on_hand: float, ref: float) -> str:
    """"out" (bitti), "low" (en az stok seviyesinde ya da altında; girilmemişse son alımın %10'u), "ok"."""
    if on_hand <= EPS:
        return "out"
    low = item.min_stock if item.min_stock else ref * LOW_SHARE
    return "low" if on_hand <= low + EPS else "ok"


def snapshot(db: Session, items: list[PriceItem], list_prices: dict[int, float]) -> dict[int, dict]:
    """Stok takibi açık kalemlerin durumu: {kalem: {on_hand, avg_cost, ref, level}}."""
    tracked = [i for i in items if i.track_stock]
    rows = _movements(db, [i.id for i in tracked])
    out = {}
    for item in tracked:
        on_hand, avg, ref = replay(rows[item.id], list_prices.get(item.id))
        out[item.id] = {"on_hand": round(on_hand, 6), "avg_cost": round(avg, 4) if avg is not None else None, "ref": round(ref, 6), "level": level(item, on_hand, ref)}
    return out


def has_movements(db: Session, item_id: int) -> bool:
    return db.scalar(select(func.count()).select_from(StockMovement).where(StockMovement.item_id == item_id)) > 0


# ------------------------------------------------------------------ birim çevirisi ----

def entry_units(item: PriceItem) -> list[str]:
    """Alım/sayım girişinde seçilebilen birimler: kalemin birimi, aynı boyuttakiler, paket (paket miktarı varsa) ve plaka kaleminde tabaka ↔ kg."""
    own = units.UNITS.get(item.unit)
    out = [item.unit]
    if own is not None:
        out += [u.code for u in units.UNITS.values() if u.dimension == own.dimension and u.code != item.unit]
    if materials.plate_kg(item):
        extra = "kg" if item.unit == "sheet" else "sheet" if own is not None and own.dimension == "mass" else None
        if extra and extra not in out:
            out.append(extra)
    if item.pack_size:
        out.append(PACK)
    return out


def to_item_unit(item: PriceItem, qty: float, unit: str) -> float:
    """`qty` miktarını (`unit` biriminde; "pack" = paket) kalemin birimine çevirir; çevrilemiyorsa 422."""
    if unit == PACK:
        if not item.pack_size:
            raise HTTPException(422, tr("Bu kalemde paket miktarı yok; önce kalemde paket miktarını yaz.", "This item has no pack size; set the pack size on the item first."))
        return qty * item.pack_size
    if unit == item.unit:
        return qty
    own, given = units.UNITS.get(item.unit), units.UNITS.get(unit)
    if own is not None and given is not None and own.dimension == given.dimension:
        return units.convert(qty, unit, item.unit)
    kg = materials.plate_kg(item)
    if kg and item.unit == "sheet" and given is not None and given.dimension == "mass":
        return units.convert(qty, unit, "kg") / kg
    if kg and own is not None and own.dimension == "mass" and unit == "sheet":
        return units.convert(qty * kg, "kg", item.unit)
    raise HTTPException(422, tr("Bu birim bu kalemle çevrilemiyor.", "This unit cannot be converted for this item."))


# ------------------------------------------------------------------ hareketler ----

def _writable(access: EntityAccess, item: PriceItem) -> None:
    access.require_member()
    if item.entity_id != access.entity.id:
        raise HTTPException(404, tr("Kalem bulunamadı", "Item not found"))
    if item.kind != "material" or not item.track_stock:
        raise HTTPException(409, tr("Bu kalemde stok takibi kapalı; önce kalemde 'Stok takibi'ni aç.", "Stock tracking is off for this item; turn on 'Track stock' on the item first."))
    if item.archived_at is not None:
        raise HTTPException(409, tr("Arşivlenmiş kalemin stoğu değiştirilemez.", "An archived item's stock cannot be changed."))


def _qty(value: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, tr("Geçersiz miktar", "Invalid quantity")) from exc
    if not 0 < v <= MAX_QTY:
        raise HTTPException(422, tr("Miktar sıfırdan büyük olmalı.", "The quantity must be above zero."))
    return v


def _current(db: Session, item: PriceItem, list_price: float | None) -> tuple[float, float | None]:
    on_hand, avg, _ = replay(_movements(db, [item.id])[item.id], list_price)
    return on_hand, avg


def _entry_net(access: EntityAccess, given: float, total: float | None, unit_price: float | None, vat_included: bool) -> float | None:
    """Girişin KDV hariç toplam tutarı (tutar yazılmadıysa None). `given`: giriş biriminde miktar."""
    amount = total if total is not None else (unit_price * given if unit_price is not None else None)
    if amount is None:
        return None
    if amount < 0:
        raise HTTPException(422, tr("Geçersiz tutar", "Invalid amount"))
    return amount / (1 + (access.entity.vat_rate or 0) / 100) if vat_included else amount


def entry_net_unit_price(access: EntityAccess, item: PriceItem, qty: float, unit: str, total: float | None, unit_price: float | None, vat_included: bool) -> float | None:
    """Girişteki KDV hariç birim fiyat, KALEMİN biriminde (fiyat listesi fiyatları KDV hariçtir); tutar yazılmadıysa None. Fiyat listesini alış fiyatına
    güncellemek için kullanılır."""
    net = _entry_net(access, _qty(qty), total, unit_price, vat_included)
    return net / to_item_unit(item, _qty(qty), unit) if net is not None else None


def add_in(db: Session, access: EntityAccess, item: PriceItem, qty: float, unit: str, total: float | None, unit_price: float | None, vat_included: bool,
           moved_on: dt.date | None, note: str) -> StockMovement:
    """Stok girişi (alım). Tutar toplam (`total`) ya da giriş birimi başına (`unit_price`) yazılır; ikisi de yoksa kayıt ortalama maliyetle
    (yoksa fiyat listesi fiyatıyla) değerlenir. KDV: tutar KDV dahilse ayrılır; maliyete eklenip eklenmeyeceği kaydın ayarına göredir (`pricing.cost_basis`)."""
    _writable(access, item)
    given = _qty(qty)
    q = to_item_unit(item, given, unit)
    net = _entry_net(access, given, total, unit_price, vat_included)
    e = access.entity
    unit_cost = pricing.cost_basis(net, e.vat_rate, e.vat_in_cost) / q if net is not None else None
    row = StockMovement(entity_id=access.entity.id, item_id=item.id, kind="purchase", qty=round(q, 6), unit_cost=round(unit_cost, 6) if unit_cost is not None else None,
                        moved_on=moved_on or dt.date.today(), note=(note or "").strip()[:200], created_by=access.user.id)
    db.add(row)
    db.commit()
    return row


def count_to(db: Session, access: EntityAccess, item: PriceItem, counted: float, unit: str, moved_on: dt.date | None, note: str, list_price: float | None) -> StockMovement | None:
    """Sayım düzeltmesi: "gerçekte şu kadar var" → fark bir düzeltme hareketi olur (fark yoksa None)."""
    _writable(access, item)
    try:
        c = float(counted)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, tr("Geçersiz miktar", "Invalid quantity")) from exc
    if not 0 <= c <= MAX_QTY:
        raise HTTPException(422, tr("Geçersiz miktar", "Invalid quantity"))
    on_hand, avg = _current(db, item, list_price)
    delta = to_item_unit(item, c, unit) - on_hand
    if abs(delta) < 1e-6:
        return None
    row = StockMovement(entity_id=access.entity.id, item_id=item.id, kind="adjust", qty=round(delta, 6), unit_cost=round(avg, 6) if avg is not None else None,
                        moved_on=moved_on or dt.date.today(), note=(note or "").strip()[:200], created_by=access.user.id)
    db.add(row)
    db.commit()
    return row


def consume(db: Session, access: EntityAccess, lines: list[tuple[int, float, str]], ref_type: str, ref_id: int, moved_on: dt.date,
            list_prices: dict[int, float]) -> dict:
    """Bir işin satırlarının (kalem, miktar, birim) stoktan düşmesi; çağıran commit eder. Stok takibi kapalı kalemler atlanır; birimi çevrilemeyen satır
    düşmez ve adı döner (sessizce atlanmaz): {"used": düşen kalem sayısı, "skipped": [kalem adı]}."""
    used, skipped = 0, []
    for item_id, qty, unit in lines:
        item = db.get(PriceItem, item_id)
        if item is None or item.entity_id != access.entity.id or item.kind != "material" or not item.track_stock or not qty:
            continue
        try:
            q = to_item_unit(item, float(qty), unit)
        except HTTPException:
            skipped.append(item.name)
            continue
        _, avg = _current(db, item, list_prices.get(item.id))
        db.add(StockMovement(entity_id=access.entity.id, item_id=item.id, kind="use", qty=-round(q, 6), unit_cost=round(avg, 6) if avg is not None else None, moved_on=moved_on,
                             ref_type=ref_type, ref_id=ref_id, created_by=access.user.id))
        db.flush()
        used += 1
    return {"used": used, "skipped": skipped}


def revert_ref(db: Session, entity_id: int, ref_type: str, ref_id: int) -> int:
    """Bir işe bağlı kullanım hareketlerini siler (iş yeniden açılınca stok geri gelir); çağıran commit eder."""
    return db.execute(delete(StockMovement).where(StockMovement.entity_id == entity_id, StockMovement.ref_type == ref_type, StockMovement.ref_id == ref_id)).rowcount


def history(db: Session, item: PriceItem, limit: int = 200) -> list[dict]:
    rows = db.execute(
        select(StockMovement, User.name, User.email).outerjoin(User, User.id == StockMovement.created_by)
        .where(StockMovement.item_id == item.id).order_by(StockMovement.moved_on.desc(), StockMovement.id.desc()).limit(limit)
    ).all()
    return [
        {"id": m.id, "kind": m.kind, "qty": m.qty, "unit_cost": m.unit_cost, "moved_on": m.moved_on.isoformat(), "ref_type": m.ref_type, "ref_id": m.ref_id, "note": m.note, "by": name or email or ""}
        for m, name, email in rows
    ]

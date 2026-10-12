"""Dış Tedarik işleri.

Bir işin iki tutarı vardır:
    tahmin  — fiyat listesinden: belgeden okunan ölçüler (ör. kesim süresi) eşlendikleri kalemlerle çarpılır.
    gerçek  — tedarikçinin istediği (belgede yazan ya da elle girilen), KDV hariç.
Maliyet olarak gerçek tutar kullanılır; girilmediyse tahmin. KDV, kayıtta "KDV maliyete dahil" seçiliyse eklenir.

Durumlar: taslak → (tedarikçi gönderir) gönderildi → (satıcı) onaylandı | itiraz edildi. Onaylanan iş değişmez;
satıcı yeniden açabilir. Onayda dağıtım planı `supply_allocations` satırlarına dönüşür: ürüne düşen pay ürünün birim
maliyeti olarak uygulanabilir, genel gidere düşen pay Finans raporundaki giderlere girer."""
import datetime as dt
import json
import re

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.listings.models import ListingCache
from app.modkit import activity, documents, mailer, materials, pricebook, pricing, products, units
from app.modkit.access import EntityAccess
from app.modkit.models import EntityDocument, FieldMapping, ModuleEntity, PriceItem
from app.modkit.numbers import DIMS, slug
from app.shops.models import Shop
from app.supply import paint, profile as doc_profile
from app.supply.models import SupplyAllocation, SupplyJob, SupplyJobLine

MODULE = "supply"
MAX_LINES = 200
MAX_TARGETS = 100
MAX_JOBS_PER_ENTITY = 20000
MAX_QTY = 1e9
ESTIMATED = "estimated"  # tahmini maliyete göre: lazer süresi payı + malzeme; gerçek tutar bu oranlarla bölünür
SPLIT_MODES = ("price", "qty", "manual", *products.WEIGHT_MODES, ESTIMATED, paint.MODE)


def _now() -> dt.datetime:
    return dt.datetime.utcnow()


def _when(job: SupplyJob) -> dt.datetime:
    """İşin fiyat tarihi: iş gününün sonu (o gün içinde girilmiş fiyat da geçerli sayılır)."""
    return dt.datetime.combine(job.job_date, dt.time.max)


# --------------------------------------------------------------- yetki ----

def _require_create(access: EntityAccess) -> None:
    if not (access.is_member or access.can("jobs.create")):
        raise HTTPException(403, "Bu işlem için yetkin yok")


def _require_editable(access: EntityAccess, job: SupplyJob) -> None:
    if job.status == "confirmed":
        raise HTTPException(409, "Onaylanmış iş değiştirilemez; önce yeniden aç.")
    _require_create(access)


def get_job(db: Session, access: EntityAccess, job_id: int) -> SupplyJob:
    job = db.get(SupplyJob, job_id)
    if job is None or job.entity_id != access.entity.id:
        raise HTTPException(404, "İş bulunamadı")
    return job


# --------------------------------------------------------------- serileştirme ----

def _basis(job: SupplyJob, vat_in_cost: bool) -> float:
    net = job.actual if job.actual is not None else job.estimate
    return pricing.cost_basis(net or 0.0, job.vat_rate, vat_in_cost)


def _lines(db: Session, job_id: int) -> list[SupplyJobLine]:
    return list(db.scalars(select(SupplyJobLine).where(SupplyJobLine.job_id == job_id).order_by(SupplyJobLine.position, SupplyJobLine.id)))


def _min_price(db: Session, entity_id: int, when: dt.datetime) -> float | None:
    item = db.scalar(select(PriceItem).where(PriceItem.entity_id == entity_id, PriceItem.kind == "minimum", PriceItem.archived_at.is_(None)))
    if item is None:
        return None
    v = pricebook.prices_at(db, [item.id], when).get(item.id)
    return v.price if v else None


def _totals(db: Session, job: SupplyJob, lines: list[SupplyJobLine]) -> pricing.Totals:
    return pricing.totals([ln.amount for ln in lines], _min_price(db, job.entity_id, _when(job)), job.vat_rate)


def serialize_job(db: Session, access: EntityAccess, job: SupplyJob, detail: bool = False) -> dict:
    vat_in_cost = access.entity.vat_in_cost
    out = {
        "id": job.id, "number": job.number, "title": job.title, "job_date": job.job_date.isoformat(), "status": job.status,
        "currency": job.currency, "vat_rate": job.vat_rate, "estimate": job.estimate, "actual": job.actual,
        "basis": _basis(job, vat_in_cost), "created_via": job.created_via, "document_id": job.document_id,
        "dispute_note": job.dispute_note, "confirmed_at": job.confirmed_at.isoformat() + "Z" if job.confirmed_at else None,
        "created_at": job.created_at.isoformat() + "Z", "updated_at": job.updated_at.isoformat() + "Z",
    }
    if access.internal and job.status == "confirmed":
        shares = [a for a in db.scalars(select(SupplyAllocation).where(SupplyAllocation.job_id == job.id)) if a.listing_id is not None]
        out["product_costs"] = {"total": len(shares), "pending": sum(a.applied_at is None for a in shares)}
    if not detail:
        return out
    lines = _lines(db, job.id)
    t = _totals(db, job, lines)
    actual_vat = pricing.with_vat(job.actual, job.vat_rate) if job.actual is not None else None
    out.update({
        "note": job.note,
        "lines": [
            {"id": ln.id, "price_item_id": ln.price_item_id, "description": ln.description, "qty": ln.qty, "unit": ln.unit,
             "unit_price": ln.unit_price, "manual_price": ln.manual_price, "amount": ln.amount, "source_key": ln.source_key}
            for ln in lines
        ],
        "estimate_totals": t.as_dict(),
        "actual_totals": {"net": job.actual, "vat": actual_vat[0], "total": actual_vat[1]} if actual_vat else None,
        "diff": round(job.actual - job.estimate, 2) if job.actual is not None and job.estimate else None,
        "vat_in_cost": vat_in_cost,
        "document": None,
    })
    if job.document_id:
        doc = db.get(EntityDocument, job.document_id)
        if doc is not None:
            out["document"] = {**documents.serialize(doc), "data": documents.data_of(doc)}
    if access.internal:  # ürün dağıtımı ve olası mükerrerler iç bilgidir, tedarikçi görmez
        out["similar"] = similar_jobs(db, job)
        out["plan"] = _plan(job)
        materials_total = _material_summary(db, access, job)
        if materials_total is not None:
            out["materials"] = materials_total
            if job.actual is not None:  # kesimci malzemeyi de veriyorsa gerçek tutar lazer + malzeme tahminiyle karşılaştırılır
                out["diff"] = round(job.actual - job.estimate - materials_total["total"], 2)
        out.update({"time_fee": job.time_fee, "time_fee_mapped": mapped_time_fee(db, job), "with_material": job.with_material,
                    "times": [{"key": m["key"], "label": m["label"], "seconds": m["value"]} for m in _time_measures(db, job)]})
        out["allocations"] = [
            {"id": a.id, "shop_id": a.shop_id, "listing_id": a.listing_id, "variant": a.variant, "title": a.title, "qty": a.qty, "amount": a.amount,
             "amount_report": a.amount_report, "report_ccy": a.report_ccy, "applied_at": a.applied_at.isoformat() + "Z" if a.applied_at else None}
            for a in db.scalars(select(SupplyAllocation).where(SupplyAllocation.job_id == job.id).order_by(SupplyAllocation.id))
        ]
    return out


def _time_measures(db: Session, job: SupplyJob) -> list[dict]:
    """Belgedeki süre ölçüleri (saniye): rapor hem kesim hem işlem süresi verebilir, hangisinin faturalandığı kullanıcıya gösterilir."""
    doc = db.get(EntityDocument, job.document_id) if job.document_id else None
    data = documents.data_of(doc) if doc else None
    return [m for m in doc_profile.normalize(data)["measures"] if m["unit"] == "s"] if data else []


def mapped_time_fee(db: Session, job: SupplyJob) -> float | None:
    """Süre ölçüsünden fiyat listesine eşlenmiş satırların toplamı (lazer süre bedeli tahmini); eşlenmiş satır yoksa None."""
    keys = {m["key"] for m in _time_measures(db, job)}
    amounts = [ln.amount for ln in _lines(db, job.id) if ln.source_key in keys and ln.amount is not None]
    return round(sum(amounts), 2) if amounts else None


def _material_summary(db: Session, access: EntityAccess, job: SupplyJob) -> dict | None:
    """Dağıtım hedeflerinin (adet dahil) kullandığı malzeme, malzeme kalemi başına toplanmış: {"total", "items": [{name, type,
    thickness, kg, cost}]}. Malzeme kesimciden değilse ya da maliyet hesaplanamıyorsa None."""
    plan = _plan(job)
    if not job.with_material or not plan["targets"]:
        return None
    items: dict[tuple, dict] = {}
    for target, usage in zip(plan["targets"], products.material_usage(db, access, plan["targets"], _when(job))):
        for p in (usage or {}).get("parts", []):
            if p["cost"] is None:
                continue
            row = items.setdefault((p["name"], p["type"], p["thickness"]), {"name": p["name"], "type": p["type"], "thickness": p["thickness"], "kg": 0.0, "cost": 0.0})
            row["kg"] += (p["kg"] or 0.0) * target["qty"]
            row["cost"] += p["cost"] * target["qty"]
    if not items:
        return None
    rows = [{**r, "kg": round(r["kg"], 3), "cost": round(r["cost"], 2)} for r in items.values()]
    return {"total": round(sum(r["cost"] for r in rows), 2), "items": rows}


def similar_jobs(db: Session, job: SupplyJob) -> list[dict]:
    """Aynı kayıtta aynı tarihli ve aynı tutarlı başka işler: aynı belgenin ekran görüntüsü ile Excel'i gibi mükerrer
    girişler. Tutar, gerçek tutar varsa o, yoksa tahmindir (işin maliyet olarak yazılacağı değer)."""
    def amount(j: SupplyJob) -> float:
        return (j.actual if j.actual is not None else j.estimate) or 0.0

    if not amount(job):
        return []
    rows = db.scalars(select(SupplyJob).where(SupplyJob.entity_id == job.entity_id, SupplyJob.id != job.id, SupplyJob.job_date == job.job_date).order_by(SupplyJob.number))
    return [{"id": j.id, "number": j.number, "title": j.title, "status": j.status} for j in rows if abs(amount(j) - amount(job)) < 0.005][:5]


def list_jobs(db: Session, access: EntityAccess, status: str = "", q: str = "", page: int = 0, per_page: int = 30) -> dict:
    stmt = select(SupplyJob).where(SupplyJob.entity_id == access.entity.id)
    if status == "open":  # bekleyenler: onaylanmamış her iş
        stmt = stmt.where(SupplyJob.status != "confirmed")
    elif status:
        stmt = stmt.where(SupplyJob.status == status)
    if q.strip():
        needle = f"%{q.strip()[:80]}%"
        stmt = stmt.where(SupplyJob.title.ilike(needle) | SupplyJob.note.ilike(needle))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(SupplyJob.job_date.desc(), SupplyJob.number.desc()).offset(page * per_page).limit(per_page)).all()
    return {"items": [serialize_job(db, access, j) for j in rows], "total": total}


# --------------------------------------------------------------- oluşturma / düzenleme ----

def _auto_lines(db: Session, entity_id: int, when: dt.datetime) -> list[dict]:
    """Her yeni işe kendiliğinden eklenen satırlar: sabit ücretler (1 iş) ve tüketim kuralı olan kalemler (kural miktarı)."""
    items = list(db.scalars(select(PriceItem).where(
        PriceItem.entity_id == entity_id, PriceItem.archived_at.is_(None), (PriceItem.kind == "fee") | PriceItem.auto_qty.is_not(None)
    ).order_by(PriceItem.position, PriceItem.id)))
    prices = pricebook.prices_at(db, [i.id for i in items], when)
    return [{"price_item_id": i.id, "description": i.name, "qty": 1.0 if i.kind == "fee" else i.auto_qty, "unit": i.unit,
             "unit_price": prices[i.id].price if i.id in prices else 0.0, "manual_price": False, "source_key": ""} for i in items]


def create_job(db: Session, access: EntityAccess, title: str, job_date: dt.date | None, note: str,
               document: EntityDocument | None = None, data: dict | None = None) -> SupplyJob:
    _require_create(access)
    n = db.scalar(select(func.count()).select_from(SupplyJob).where(SupplyJob.entity_id == access.entity.id)) or 0
    if n >= MAX_JOBS_PER_ENTITY:
        raise HTTPException(422, "İş sınırına ulaşıldı")
    vat_rate = access.entity.vat_rate
    if data and data.get("vat_rate") is not None:
        vat_rate = float(data["vat_rate"])
    job = None
    for _ in range(5):  # numara yarışı: aynı anda iki iş açılırsa benzersizlik kısıtı yakalar, tekrar denenir
        number = (db.scalar(select(func.max(SupplyJob.number)).where(SupplyJob.entity_id == access.entity.id)) or 0) + 1
        candidate = SupplyJob(
            entity_id=access.entity.id, number=number, title=(title or "").strip()[:200], job_date=job_date or dt.date.today(),
            status="draft", currency=access.entity.currency, vat_rate=vat_rate, note=(note or "").strip()[:5000],
            document_id=document.id if document else None, created_by=access.user.id, created_via="guest" if access.is_guest else "owner",
        )
        try:
            with db.begin_nested():
                db.add(candidate)
                db.flush()
            job = candidate
            break
        except IntegrityError:
            continue
    if job is None:
        raise HTTPException(409, "İş numarası ayrılamadı, tekrar dene")
    lines = _auto_lines(db, access.entity.id, _when(job))
    if data is not None:
        lines = build_lines_from_document(db, access, data, _when(job)) + lines
        if data.get("net") is not None:
            job.actual = round(float(data["net"]), 2)
    _write_lines(db, job, lines)
    activity.log(db, access.entity.id, access.user, "job_created", {"number": job.number, "title": job.title, "by_guest": access.is_guest})
    db.commit()
    return job


def _clean_qty(v) -> float:
    try:
        q = float(v)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "Geçersiz miktar") from exc
    if not 0 <= q <= MAX_QTY:
        raise HTTPException(422, "Geçersiz miktar")
    return round(q, 6)


def _resolve_lines(db: Session, access: EntityAccess, job: SupplyJob, raw: list[dict]) -> list[dict]:
    """İstemciden gelen satırları doğrular; fiyat listesine bağlı satırın birimi ve (elle değilse) fiyatı sunucudan gelir."""
    if len(raw) > MAX_LINES:
        raise HTTPException(422, "Satır sınırına ulaşıldı")
    ids = {int(r["price_item_id"]) for r in raw if r.get("price_item_id")}
    items = {i.id: i for i in db.scalars(select(PriceItem).where(PriceItem.id.in_(ids), PriceItem.entity_id == access.entity.id))} if ids else {}
    if len(items) != len(ids):
        raise HTTPException(404, "Kalem bulunamadı")
    prices = pricebook.prices_at(db, list(items), _when(job))
    out = []
    for r in raw:
        qty = _clean_qty(r.get("qty", 1))
        manual = bool(r.get("manual_price"))
        item = items.get(int(r["price_item_id"])) if r.get("price_item_id") else None
        if item is not None:
            unit = item.unit
            desc = (r.get("description") or item.name).strip()[:200] or item.name
            unit_price = pricebook.clean_price(r.get("unit_price")) if manual else (prices[item.id].price if item.id in prices else 0.0)
        else:
            desc = (r.get("description") or "").strip()[:200]
            if not desc:
                raise HTTPException(422, "Satır açıklaması boş olamaz")
            unit = r.get("unit") if r.get("unit") in units.UNITS else "piece"
            unit_price = pricebook.clean_price(r.get("unit_price") or 0)
            manual = True
        out.append({"price_item_id": item.id if item else None, "description": desc, "qty": qty, "unit": unit,
                    "unit_price": unit_price, "manual_price": manual, "source_key": str(r.get("source_key") or "")[:120]})
    return out


def _write_lines(db: Session, job: SupplyJob, lines: list[dict]) -> None:
    db.execute(delete(SupplyJobLine).where(SupplyJobLine.job_id == job.id))
    objs = []
    for i, ln in enumerate(lines[:MAX_LINES]):
        obj = SupplyJobLine(
            job_id=job.id, price_item_id=ln["price_item_id"], description=ln["description"], qty=ln["qty"], unit=ln["unit"],
            unit_price=ln["unit_price"], manual_price=ln["manual_price"], amount=pricing.line_amount(ln["qty"], ln["unit_price"]),
            source_key=ln.get("source_key", ""), position=i,
        )
        db.add(obj)
        objs.append(obj)
    db.flush()
    job.estimate = _totals(db, job, objs).net
    job.updated_at = _now()  # tutar aynı kalsa da değişiklik görünsün (ön yüz düzenleyicileri buna göre tazelenir)


def refresh_prices(db: Session, job: SupplyJob) -> None:
    """Taslak işte fiyat listesine bağlı (elle olmayan) satırların fiyatı, işin tarihindeki güncel fiyatla tazelenir: liste fiyatı
    değişince ya da geçmişe tarihli düzeltilince açık işler kendiliğinden doğru tutarı gösterir. Onaylanmış işe dokunulmaz."""
    if job.status not in ("draft", "disputed"):
        return
    lines = [ln for ln in _lines(db, job.id) if ln.price_item_id and not ln.manual_price]
    prices = pricebook.prices_at(db, list({ln.price_item_id for ln in lines}), _when(job))
    stale = [ln for ln in lines if ln.price_item_id in prices and abs(prices[ln.price_item_id].price - ln.unit_price) > 1e-9]
    if not stale:
        return
    for ln in stale:
        ln.unit_price = prices[ln.price_item_id].price
        ln.amount = pricing.line_amount(ln.qty, ln.unit_price)
    db.flush()
    job.estimate = _totals(db, job, _lines(db, job.id)).net
    job.updated_at = _now()
    db.commit()


def set_lines(db: Session, access: EntityAccess, job: SupplyJob, raw: list[dict]) -> None:
    _require_editable(access, job)
    _write_lines(db, job, _resolve_lines(db, access, job, raw))
    activity.log(db, access.entity.id, access.user, "job_lines_changed", {"number": job.number})
    db.commit()


def update_job(db: Session, access: EntityAccess, job: SupplyJob, fields: dict) -> None:
    _require_editable(access, job)
    reprice = False
    if fields.get("title") is not None:
        job.title = fields["title"].strip()[:200]
    if fields.get("note") is not None:
        job.note = fields["note"].strip()[:5000]
    if fields.get("job_date") is not None and fields["job_date"] != job.job_date:
        job.job_date = fields["job_date"]
        reprice = True
    if fields.get("vat_rate") is not None:
        v = float(fields["vat_rate"])
        if not 0 <= v <= 100:
            raise HTTPException(422, "Geçersiz KDV oranı")
        job.vat_rate = round(v, 2)
    if "actual" in fields:
        a = fields["actual"]
        job.actual = None if a is None else pricebook.clean_price(a)
    if "time_fee" in fields or fields.get("with_material") is not None:
        access.require_member()  # tahmini dağıtım ayarları iç bilgidir, tedarikçi değiştiremez
    if "time_fee" in fields:
        fee = fields["time_fee"]
        job.time_fee = None if fee is None else pricebook.clean_price(fee)
    if fields.get("with_material") is not None:
        job.with_material = bool(fields["with_material"])
    if reprice:  # tarih değişti: listeye bağlı (elle olmayan) satırların fiyatı yeni tarihteki fiyat olur
        current = [{"price_item_id": ln.price_item_id, "description": ln.description, "qty": ln.qty, "unit": ln.unit,
                    "unit_price": ln.unit_price, "manual_price": ln.manual_price or ln.price_item_id is None, "source_key": ln.source_key}
                   for ln in _lines(db, job.id)]
        _write_lines(db, job, _resolve_lines(db, access, job, current))
    else:
        job.estimate = _totals(db, job, _lines(db, job.id)).net
    activity.log(db, access.entity.id, access.user, "job_updated", {"number": job.number})
    db.commit()


def delete_job(db: Session, access: EntityAccess, job: SupplyJob) -> None:
    if job.status == "confirmed":
        raise HTTPException(409, "Onaylanmış iş silinemez; önce yeniden aç.")
    if not (access.is_member or (access.can("jobs.create") and job.created_by == access.user.id)):
        raise HTTPException(403, "Bu işlem için yetkin yok")
    activity.log(db, access.entity.id, access.user, "job_deleted", {"number": job.number, "title": job.title})
    db.delete(job)
    db.commit()


# --------------------------------------------------------------- belgeden iş ----

def _mappings(db: Session, entity_id: int) -> dict[str, int]:
    return dict(db.execute(select(FieldMapping.field_key, FieldMapping.price_item_id).where(
        FieldMapping.entity_id == entity_id, FieldMapping.profile == doc_profile.KEY
    )).all())


def build_lines_from_document(db: Session, access: EntityAccess, data: dict, when: dt.datetime) -> list[dict]:
    """Belgeden okunanlar → tahmin satırları. Yalnızca fiyat kalemine EŞLENMİŞ alanlar satır olur (ölçü × kalem fiyatı);
    belgede yazan tutarlar tahmine değil "gerçek tutar"a gider — ikisi karışmaz, aynı kalem iki kez sayılmaz."""
    maps = _mappings(db, access.entity.id)
    if not maps:
        return []
    items = {i.id: i for i in db.scalars(select(PriceItem).where(
        PriceItem.id.in_(set(maps.values())), PriceItem.entity_id == access.entity.id, PriceItem.archived_at.is_(None)
    ))}
    prices = pricebook.prices_at(db, list(items), when)
    out = []
    for m in data.get("measures") or []:
        item = items.get(maps.get(m.get("key"), -1))
        if item is None or not units.compatible(m.get("unit") or "", item.unit):
            continue
        qty = round(units.convert(float(m["value"]), m["unit"], item.unit), 6)
        out.append({"price_item_id": item.id, "description": item.name, "qty": qty, "unit": item.unit,
                    "unit_price": prices[item.id].price if item.id in prices else 0.0, "manual_price": False, "source_key": m["key"]})
    for ln in data.get("lines") or []:
        item = items.get(maps.get(ln.get("key"), -1))
        if item is None:
            continue
        qty = ln.get("qty") or 1.0
        if ln.get("unit") and units.compatible(ln["unit"], item.unit):
            qty = units.convert(float(qty), ln["unit"], item.unit)
        out.append({"price_item_id": item.id, "description": item.name, "qty": round(float(qty), 6), "unit": item.unit,
                    "unit_price": prices[item.id].price if item.id in prices else 0.0, "manual_price": False, "source_key": ln["key"]})
    return out


def rebuild_from_document(db: Session, access: EntityAccess, job: SupplyJob) -> None:
    """Eşlemeler değişti: belgeden gelen satırlar yeniden kurulur, elle eklenen satırlar korunur."""
    _require_editable(access, job)
    doc = db.get(EntityDocument, job.document_id) if job.document_id else None
    data = documents.data_of(doc) if doc else None
    if data is None:
        raise HTTPException(409, "Bu işin okunmuş bir belgesi yok")
    keep = [{"price_item_id": ln.price_item_id, "description": ln.description, "qty": ln.qty, "unit": ln.unit, "unit_price": ln.unit_price,
             "manual_price": ln.manual_price, "source_key": ""}
            for ln in _lines(db, job.id) if not ln.source_key]
    _write_lines(db, job, build_lines_from_document(db, access, doc_profile.normalize(data), _when(job)) + keep)
    activity.log(db, access.entity.id, access.user, "job_lines_changed", {"number": job.number})
    db.commit()


def attach_analysis(db: Session, access: EntityAccess, doc: EntityDocument, data: dict | None, source: str,
                    create: bool, job_id: int | None) -> SupplyJob | None:
    """Okunan belgeyi kaydeder; istenirse yeni iş açar ya da var olan işe bağlar."""
    documents.set_result(doc, data, source)
    activity.log(db, access.entity.id, access.user, "document_added", {"filename": doc.filename, "source": source})
    if job_id is not None:
        job = get_job(db, access, job_id)
        _require_editable(access, job)
        job.document_id = doc.id
        db.commit()
        if data is not None:
            if data.get("net") is not None and job.actual is None:
                job.actual = round(float(data["net"]), 2)
            rebuild_from_document(db, access, job)
        return job
    if create and data is not None:
        return job_for_document(db, access, doc) or job_from_document(db, access, doc, data)
    db.commit()
    return None


def job_for_document(db: Session, access: EntityAccess, doc: EntityDocument) -> SupplyJob | None:
    """Belgeden açılmış iş varsa o (aynı belgeden ikinci iş açılmasın)."""
    return db.scalars(
        select(SupplyJob).where(SupplyJob.entity_id == access.entity.id, SupplyJob.document_id == doc.id).order_by(SupplyJob.number).limit(1)
    ).first()


def job_from_document(db: Session, access: EntityAccess, doc: EntityDocument, data: dict) -> SupplyJob:
    """Okunmuş belgeden yeni iş: tarih ve başlık belgeden, satırlar eşlemelerden, gerçek tutar belgedeki KDV hariç toplamdan."""
    when_date = None
    if data.get("date"):
        try:
            when_date = dt.date.fromisoformat(data["date"])
        except ValueError:
            when_date = None
    title = data.get("doc_number") or doc.filename.rsplit(".", 1)[0]
    return create_job(db, access, title, when_date, "", document=doc, data=data)


# --------------------------------------------------------------- durum geçişleri ----

def submit(db: Session, access: EntityAccess, job: SupplyJob) -> None:
    _require_create(access)
    if job.status not in ("draft", "disputed"):
        raise HTTPException(409, "Bu iş şu an gönderilemez")
    job.status = "submitted"
    activity.log(db, access.entity.id, access.user, "job_submitted", {"number": job.number, "by_guest": access.is_guest})
    db.commit()
    if access.is_guest:
        who = access.user.name or access.user.email
        mailer.notify_members(
            db, access.entity, "job_submitted",
            f"{access.entity.name}: iş #{job.number} onayını bekliyor", f"{access.entity.name}: job #{job.number} is waiting for you",
            [("Gönderen", who), ("İş", job.title or f"#{job.number}")], [("From", who), ("Job", job.title or f"#{job.number}")],
            f"/{MODULE}/{access.entity.id}?tab=jobs&job={job.id}",
        )


def dispute(db: Session, access: EntityAccess, job: SupplyJob, note: str) -> None:
    access.require_member()
    if job.status not in ("submitted", "draft"):
        raise HTTPException(409, "Bu işe şu an itiraz edilemez")
    job.status = "disputed"
    job.dispute_note = (note or "").strip()[:500]
    activity.log(db, access.entity.id, access.user, "job_disputed", {"number": job.number, "note": job.dispute_note})
    db.commit()


def confirm(db: Session, access: EntityAccess, job: SupplyJob, allow_duplicate: bool = False) -> None:
    access.require_member()
    if job.status == "confirmed":
        return
    twin = next((s for s in similar_jobs(db, job) if s["status"] == "confirmed"), None)
    if twin and not allow_duplicate:  # aynı maliyet iki kez Finans'a yazılmasın
        raise HTTPException(409, tr(f"Aynı tarih ve tutarda onaylanmış bir iş var (#{twin['number']}). Mükerrer olabilir; yine de onaylamak için onayı tekrarla.",
                                    f"A confirmed job with the same date and amount exists (#{twin['number']}). It may be a duplicate; confirm again to proceed anyway."))
    plan = _plan(job)
    if not plan["targets"]:
        raise HTTPException(422, "Onaylamadan önce maliyetin nereye yazılacağını seç (ürünler ya da genel gider).")
    basis = _basis(job, access.entity.vat_in_cost)
    if basis <= 0:
        raise HTTPException(422, "İşin tutarı sıfır; satır ekle ya da gerçek tutarı gir.")
    amounts = split(db, access, job, basis, plan)
    _materialize(db, access, job, plan, amounts)
    summary_ = _material_summary(db, access, job)
    job.material_cost = summary_["total"] if summary_ else None
    job.status = "confirmed"
    job.confirmed_at = _now()
    job.confirmed_by = access.user.id
    activity.log(db, access.entity.id, access.user, "job_confirmed", {"number": job.number, "amount": basis, "currency": job.currency})
    db.commit()


def reopen(db: Session, access: EntityAccess, job: SupplyJob) -> None:
    access.require_member()
    if job.status != "confirmed":
        return
    _revert_costs(db, access, job)  # uygulanmış ürün maliyetleri de geri alınır (yoksa eski pay Finans'ta takılı kalırdı)
    db.execute(delete(SupplyAllocation).where(SupplyAllocation.job_id == job.id))
    job.material_cost = None
    job.status = "draft"
    job.confirmed_at = None
    job.confirmed_by = None
    activity.log(db, access.entity.id, access.user, "job_reopened", {"number": job.number})
    db.commit()


# --------------------------------------------------------------- dağıtım ----

def _plan(job: SupplyJob) -> dict:
    try:
        plan = json.loads(job.allocation_plan or "{}")
    except json.JSONDecodeError:
        plan = {}
    if isinstance(plan, list):  # eski biçim
        plan = {"mode": "qty", "targets": plan}
    return {"mode": plan.get("mode") if plan.get("mode") in SPLIT_MODES else "price", "targets": plan.get("targets") or []}


def set_plan(db: Session, access: EntityAccess, job: SupplyJob, mode: str, targets: list[dict]) -> dict:
    access.require_member()
    if job.status == "confirmed":
        raise HTTPException(409, "Onaylanmış iş değiştirilemez; önce yeniden aç.")
    if mode not in SPLIT_MODES:
        raise HTTPException(422, "Geçersiz paylaştırma")
    if len(targets) > MAX_TARGETS:
        raise HTTPException(422, "Hedef sınırına ulaşıldı")
    shops = products.workspace_shops(db, access.entity.workspace_id)
    clean, seen = [], set()
    for t in targets:
        shop_id = int(t.get("shop_id") or 0)
        if shop_id not in shops:
            raise HTTPException(404, "Mağaza bulunamadı")
        listing_id = int(t["listing_id"]) if t.get("listing_id") else None
        title, price, variant = "", 0.0, ""
        if listing_id is not None:
            row = db.execute(select(ListingCache.title, ListingCache.raw_json).where(ListingCache.shop_id == shop_id, ListingCache.listing_id == listing_id)).first()
            if row is None:
                raise HTTPException(404, "Ürün bulunamadı")
            title, price = products.clean_title(row[0]), products.listing_price(row[1])
            variant = products.check_variant(db, shop_id, listing_id, t.get("variant") or "")
        key = (shop_id, listing_id, variant)
        if key in seen:
            raise HTTPException(422, "Aynı hedef iki kez seçilmiş")
        seen.add(key)
        qty = int(t.get("qty") or 1)
        if not 1 <= qty <= 1_000_000:
            raise HTTPException(422, "Geçersiz miktar")
        amount = t.get("amount")
        if mode == "manual":
            amount = pricebook.clean_price(amount)
        clean.append({"shop_id": shop_id, "listing_id": listing_id, "variant": variant, "title": title, "qty": qty, "price": price,
                      "amount": amount if mode == "manual" else None, "item_id": paint.clean_item(db, access, t.get("item_id")) if mode == paint.MODE else None})
    if mode == "price" and any(c["listing_id"] is None for c in clean) and any(c["listing_id"] is not None for c in clean):
        raise HTTPException(422, "Fiyat payına göre bölüştürmede genel gider seçilemez; 'adet' ya da 'elle' bölüştür.")
    if (mode in products.WEIGHT_MODES or mode in (ESTIMATED, paint.MODE)) and any(c["listing_id"] is None for c in clean):
        raise HTTPException(422, "Ölçüye göre bölüştürmede genel gider seçilemez; 'adet' ya da 'elle' bölüştür.")
    if mode == paint.MODE:
        paint.remember(db, access, clean)
    job.allocation_plan = json.dumps({"mode": mode, "targets": clean}, ensure_ascii=False)
    job.updated_at = _now()
    activity.log(db, access.entity.id, access.user, "plan_changed", {"number": job.number, "targets": len(clean)}, internal=True)
    db.commit()
    return preview(db, access, job)


def _estimates(db: Session, access: EntityAccess, job: SupplyJob, plan: dict) -> tuple[list[dict], float]:
    """"Tahmini maliyete göre" bölüştürmenin ürün başına lazer + malzeme tahmini ve plakanın seçilmeyen kısmının lazer bedeli. Süre bedeli elle yazılan, yoksa süre ölçüsüne
    eşlenen satırlardır; malzeme kesimciden değilse yalnızca kesim uzunluğu payı kullanılır (süre bedeli gerekmez)."""
    fee = job.time_fee if job.time_fee is not None else mapped_time_fee(db, job)
    if job.with_material and not fee:
        raise HTTPException(422, tr("Süre bedeli yok: işte 'Süre bedeli'ni yaz ya da raporun süresini fiyat listesinden bir kaleme eşle.",
                                    "There is no time fee: enter the job's 'Time fee' or map the report's time to a price item."))
    return products.estimates(db, access, plan["targets"], fee or 1.0, job.with_material, _when(job), _doc_total(db, job, "cut_length"))


def split(db: Session, access: EntityAccess, job: SupplyJob, basis: float, plan: dict) -> list[float]:
    """Tutarı hedeflere böler; kuruş farkı son hedefe yazılır (toplam her zaman tutara eşit)."""
    targets = plan["targets"]
    if not targets:
        return []
    rest = 0.0
    if plan["mode"] == paint.MODE:  # m² fiyatından hesaplanır; tutara eşitlenmez
        return paint.amounts(db, access, targets, _when(job))[0]
    if plan["mode"] == "manual":
        amounts = [round(float(t.get("amount") or 0), 2) for t in targets]
        if abs(sum(amounts) - basis) > 0.05:
            raise HTTPException(422, tr(f"Elle girilen tutarların toplamı ({sum(amounts):.2f}) işin tutarına ({basis:.2f}) eşit olmalı.",
                                        f"The manual amounts add up to {sum(amounts):.2f}; they must equal the job amount ({basis:.2f})."))
        amounts[-1] = round(basis - sum(amounts[:-1]), 2)
        return amounts
    if plan["mode"] == "price":
        weights = [(t.get("price") or 0) * t["qty"] for t in targets]
        if not any(weights):  # fiyat bilinmiyorsa adede göre
            weights = [t["qty"] for t in targets]
    elif plan["mode"] in products.WEIGHT_MODES:
        weights = products.weights(db, access, targets, plan["mode"])
    elif plan["mode"] == ESTIMATED:
        rows, rest = _estimates(db, access, job, plan)
        weights = [e["laser"] + e["material"] for e in rows]
    else:
        weights = [t["qty"] for t in targets]
    total = (sum(weights) + rest) or 1
    amounts = [round(basis * w / total, 2) for w in weights]
    if not rest:  # plakanın seçilmeyen kısmı varsa o pay dağıtılmaz (toplam tutardan küçük kalır); yoksa kuruş farkı son hedefe
        amounts[-1] = round(basis - sum(amounts[:-1]), 2)
    return amounts


def _report_amounts(db: Session, access: EntityAccess, job: SupplyJob, plan: dict, amounts: list[float]) -> list[dict | None]:
    """Payların mağazanın rapor para birimindeki karşılığı (Finans'a yazılacak tutar): {"amount", "currency", "rate"}; para birimi aynıysa
    ya da kur alınamıyorsa None (önizleme hata vermez, onayda kur zorunludur)."""
    from app.finance import service as finance_service

    shops = products.workspace_shops(db, access.entity.workspace_id)
    out: list[dict | None] = []
    for t, amount in zip(plan["targets"], amounts):
        shop = shops.get(t["shop_id"])
        ccy = finance_service.report_currency(db, shop) if shop else job.currency
        try:
            rate = fx_rate(job.currency, ccy, job.job_date)
        except HTTPException:
            out.append(None)
            continue
        out.append(None if ccy == job.currency else {"amount": round(amount * rate, 2), "currency": ccy, "rate": rate})
    return out


def preview(db: Session, access: EntityAccess, job: SupplyJob) -> dict:
    access.require_member()
    plan = _plan(job)
    basis = _basis(job, access.entity.vat_in_cost)
    try:
        amounts = split(db, access, job, basis, plan) if plan["targets"] else []
        estimate = _estimates(db, access, job, plan)[0] if plan["mode"] == ESTIMATED and plan["targets"] else []
        error = None
    except HTTPException as exc:
        amounts, estimate, error = [], [], str(exc.detail)
    usage = products.material_usage(db, access, plan["targets"], _when(job)) if plan["targets"] else []
    reports = _report_amounts(db, access, job, plan, amounts)
    paint_ids = [i.id if i else None for i in paint.items_for(db, access, plan["targets"])] if plan["mode"] == paint.MODE else None  # seçilmiş, kayıtlı ya da tek uygun kalem
    return {"mode": plan["mode"], "basis": basis, "currency": job.currency, "error": error,
            "unallocated": round(basis - sum(amounts), 2) if amounts and plan["mode"] in (ESTIMATED, paint.MODE) else None,
            "paint_items": [{"id": i.id, "name": i.name} for i in paint.candidates(db, access.entity.id)] if plan["mode"] == paint.MODE else None,
            "check": _measure_check(db, access, job, plan) if plan["targets"] and error is None else None,
            "targets": [{**t, "share": amounts[i] if i < len(amounts) else None,
                         **({"estimate": {k: round(v, 2) for k, v in estimate[i].items()}} if i < len(estimate) else {}),
                         "material": usage[i], "report": reports[i] if i < len(reports) else None,
                         **({"item_id": paint_ids[i]} if paint_ids else {}),
                         "unit_share": round(amounts[i] / t["qty"], 4) if i < len(amounts) and t["qty"] else None}
                        for i, t in enumerate(plan["targets"])]}


# Belgedeki (makine raporu) toplam ölçü: ürün ölçüleri toplamıyla karşılaştırılır. Ölçü anahtarı → (belge anahtarı, birim)
_DOC_TOTALS = {"cut_length": ("total_cut_length", "mm"), "pierce_count": ("pierce_count", "piece")}


def _doc_total(db: Session, job: SupplyJob, measure: str) -> float | None:
    """Belgedeki (makine raporu) toplam ölçü, ürün ölçüsünün biriminde; belge ya da ölçü yoksa None."""
    ref = _DOC_TOTALS.get(measure)
    doc = db.get(EntityDocument, job.document_id) if job.document_id else None
    data = documents.data_of(doc) if doc else None
    found = next((m for m in doc_profile.normalize(data)["measures"] if m["key"] == ref[0]), None) if ref and data else None
    try:
        return units.convert(found["value"], found["unit"], ref[1]) if found else None
    except (KeyError, ValueError):
        return None


def _measure_check(db: Session, access: EntityAccess, job: SupplyJob, plan: dict) -> dict | None:
    """Ürünlerin (adet × ölçü) toplamı belgedeki toplamla ne kadar uyuşuyor; seçilen ürünler plakayı tam karşılıyor mu."""
    measure = "cut_length" if plan["mode"] == ESTIMATED else plan["mode"]  # tahmini dağıtımın lazer payı kesim uzunluğuna dayanır
    expected = _doc_total(db, job, measure)
    if not expected:
        return None
    try:
        actual = sum(products.weights(db, access, plan["targets"], measure))
    except HTTPException:
        return None
    return {"measure": measure, "expected": round(expected, 1), "actual": round(actual, 1), "diff_pct": round((actual - expected) / expected * 100, 1)}


# ---- belge satırlarından ürün önerisi

_SIZE_TOLERANCE = 0.03
_MIN_WORD = 4
_COMMON_WORDS = {"siyah", "beyaz", "metal", "sign", "plaka", "sheet", "sheets", "adet", "lazer", "kesim", "bedeli", "total"}


def _words(text: str) -> set[str]:
    return {w for w in slug(text).split("_") if len(w) >= _MIN_WORD and not w.isdigit() and w not in _COMMON_WORDS}


def _same_size(found: tuple[float, float], width: float, height: float) -> bool:
    """Belgedeki ebat ürünün ebadıyla (mm ya da cm yazılmış, yönü fark etmez) %3 içinde uyuşuyor mu."""
    lo, hi = sorted(found)
    small, large = sorted((width, height))
    return any(abs(lo * k - small) <= _SIZE_TOLERANCE * small and abs(hi * k - large) <= _SIZE_TOLERANCE * large for k in (1, 10))


def suggest_targets(db: Session, access: EntityAccess, job: SupplyJob) -> list[dict]:
    """Belgede yazan satırlar ve notlar ("930x550 2mm alüminyum = 1024") ile Ürünler sekmesine girilmiş ürünler karşılaştırılır:
    ebat uyuşan ya da adında en az iki ortak anlamlı sözcük geçen ürünler önerilir. Satırda malzeme ya da kalınlık yazıyorsa ve
    ürünün malzeme kaleminin adında ("2mm dkp") da varsa uyuşmayanlar elenir. Öneridir, hiçbir şey kendiliğinden eklenmez."""
    access.require_member()
    doc = db.get(EntityDocument, job.document_id) if job.document_id else None
    data = documents.data_of(doc) if doc else None
    if data is None:
        return []
    norm = doc_profile.normalize(data)
    texts = [(ln["description"], ln["amount"]) for ln in norm["lines"]] + [(f"{i['label']}: {i['text']}", None) for i in norm["info"]]
    products_ = products.list_measures(db, access)
    out = []
    for text, amount in texts:
        sizes = [tuple(float(x.replace(",", ".")) for x in m) for m in DIMS.findall(text)]
        words = _words(text)
        thick = materials.thicknesses(text)
        material = materials.detect(text, sheet_only=True)  # ürün levha malzemedendir; satırdaki ambalaj sözcükleri eşleşmeyi bozmasın
        matches: dict[tuple[int, int, str], dict] = {}
        for p in products_:
            v = p["values"]
            if material and p["material"] and p["material"] != material:
                continue
            if thick and v.get("thickness") and not any(abs(x - v["thickness"]) < 0.05 for x in thick):
                continue
            by_size = bool(v.get("width") and v.get("height")) and any(_same_size(s, v["width"], v["height"]) for s in sizes)
            by_name = len(words & _words(p["title"])) >= 2
            key = (p["shop_id"], p["listing_id"], p["variant"])
            if (by_size or by_name) and (key not in matches or by_size):  # çok parçalı üründe ebat eşleşmesi ad eşleşmesinin önüne geçer
                matches[key] = {"shop_id": p["shop_id"], "listing_id": p["listing_id"], "variant": p["variant"], "title": p["title"], "reason": "size" if by_size else "name"}
        if matches:
            out.append({"line": text[:200], "amount": amount, "matches": list(matches.values())[:5]})
    return out[:20]


_FX_CACHE: dict[tuple[str, str, dt.date], float] = {}  # geçmiş tarihli kurlar değişmez


def fx_rate(currency: str, report_ccy: str, on: dt.date) -> float:
    """1 iş para birimi = kaç rapor para birimi, işin tarihindeki kurla. Kur alınamazsa hata verir: TL tutarın sessizce dolar sayılması
    (kur 1,0) maliyeti yüzlerce kat bozar."""
    from app.finance.invoices import resolve_fx

    if currency == report_ccy:
        return 1.0
    key = (currency, report_ccy, on)
    if key not in _FX_CACHE:
        _, rate, source = resolve_fx(currency, 1.0, on.isoformat(), report_ccy, None)
        if source.startswith("kur alınamadı"):
            raise HTTPException(503, tr(f"{on:%d.%m.%Y} tarihli {currency}/{report_ccy} kuru alınamadı; biraz sonra tekrar dene.",
                                        f"The {currency}/{report_ccy} rate for {on:%d.%m.%Y} could not be fetched; try again shortly."))
        _FX_CACHE[key] = rate
    return _FX_CACHE[key]


def _materialize(db: Session, access: EntityAccess, job: SupplyJob, plan: dict, amounts: list[float]) -> None:
    """Planı dağıtım satırlarına çevirir; her mağaza payı o mağazanın rapor para birimine işin tarihindeki kurla çevrilir."""
    from app.finance import service as finance_service

    db.execute(delete(SupplyAllocation).where(SupplyAllocation.job_id == job.id))
    shops = products.workspace_shops(db, access.entity.workspace_id)
    for t, amount in zip(plan["targets"], amounts):
        shop = shops.get(t["shop_id"])
        if shop is None:
            raise HTTPException(404, "Mağaza bulunamadı")
        report_ccy = finance_service.report_currency(db, shop)
        rate = fx_rate(job.currency, report_ccy, job.job_date)
        db.add(SupplyAllocation(
            job_id=job.id, shop_id=shop.id, listing_id=t["listing_id"], variant=t.get("variant") or "", title=t.get("title") or "", qty=t["qty"],
            amount=amount, amount_report=round(amount * rate, 4), report_ccy=report_ccy, fx_rate=rate,
        ))


def apply_unit_cost(db: Session, access: EntityAccess, allocation_id: int) -> dict:
    """Ürüne düşen payı ürünün birim maliyeti olarak Finans'a yazar (Finans › Ürünler'deki maliyet alanı)."""
    access.require_member()
    a = db.get(SupplyAllocation, allocation_id)
    job = db.get(SupplyJob, a.job_id) if a else None
    if a is None or job is None or job.entity_id != access.entity.id or a.listing_id is None:
        raise HTTPException(404, "Dağıtım bulunamadı")
    result = _apply_allocation(db, access, a)
    db.commit()
    return result


def apply_job_costs(db: Session, access: EntityAccess, job: SupplyJob) -> dict:
    """Onaylanmış işin henüz uygulanmamış tüm ürün paylarını Finans'a birim maliyet olarak yazar (tek adımda, hepsi ya da hiçbiri)."""
    access.require_member()
    if job.status != "confirmed":
        raise HTTPException(409, "Önce işi onayla.")
    pending = [a for a in db.scalars(select(SupplyAllocation).where(SupplyAllocation.job_id == job.id).order_by(SupplyAllocation.id))
               if a.listing_id is not None and a.applied_at is None]
    for a in pending:
        _apply_allocation(db, access, a)
    db.commit()
    return {"applied": len(pending)}


def _apply_allocation(db: Session, access: EntityAccess, a: SupplyAllocation) -> dict:
    """Payı Finans'a, işin tarihinden geçerli birim maliyet sürümü olarak yazar: o tarihten önceki siparişler eski maliyetle kalır,
    ürün kârlılığı güncel (en son) maliyeti kullanır. Aynı payı yeniden uygulamak sürümü yinelemez. Çağıran commit eder."""
    from app.finance import service as finance_service

    shop = db.get(Shop, a.shop_id)
    job = db.get(SupplyJob, a.job_id)
    if shop is None or job is None or shop.workspace_id != access.entity.workspace_id:
        raise HTTPException(404, "Mağaza bulunamadı")
    unit = round(a.amount_report / (a.qty or 1), 2)  # Finans'a kuruş hassasiyetinde yazılır
    ref = f"supply:{a.id}"
    finance_service.remove_unit_costs(db, shop, ref)
    # Seçeneğe düşen pay, o seçeneğe giren her kombinasyonun (renkler) birim maliyeti olur; kargo ve yüzde varsa korunur.
    options = {o["key"]: o["combos"] for o in products.listing_variants(db, shop.id, a.listing_id)} if a.variant else {}
    entity = db.get(ModuleEntity, job.entity_id)
    component, name = f"{MODULE}:{job.entity_id}", " · ".join(x for x in (entity.label, entity.name) if x)  # bu tedarikçi kaydı ürünün maliyetinde kendi bileşenidir
    for key in (options.get(a.variant) or [a.variant]) if a.variant else [""]:
        finance_service.record_unit_cost(db, shop, a.listing_id, key, unit, job.job_date, ref, MODULE, component, name)
    a.applied_at = _now()
    activity.log(db, access.entity.id, access.user, "unit_cost_applied", {"title": products.label(a.title, a.variant), "unit_cost": unit, "currency": a.report_ccy}, internal=True)
    return {"unit_cost": unit, "currency": a.report_ccy}


def _revert_costs(db: Session, access: EntityAccess, job: SupplyJob) -> int:
    """İşin Finans'a uygulanmış birim maliyetlerini geri alır: eklenen sürümler silinir, maliyet uygulamadan önceki haline döner.
    Çağıran commit eder."""
    from app.finance import service as finance_service

    applied = [a for a in db.scalars(select(SupplyAllocation).where(SupplyAllocation.job_id == job.id)) if a.listing_id is not None and a.applied_at is not None]
    for a in applied:
        shop = db.get(Shop, a.shop_id)
        if shop is not None:
            finance_service.remove_unit_costs(db, shop, f"supply:{a.id}")
        a.applied_at = None
    if applied:
        activity.log(db, access.entity.id, access.user, "unit_cost_reverted", {"number": job.number, "count": len(applied)}, internal=True)
    return len(applied)


def undo_job_costs(db: Session, access: EntityAccess, job: SupplyJob) -> dict:
    access.require_member()
    reverted = _revert_costs(db, access, job)
    db.commit()
    return {"reverted": reverted}


# --------------------------------------------------------------- özet ve rapor ----

def summary(db: Session, access: EntityAccess) -> dict:
    eid = access.entity.id
    counts = dict(db.execute(select(SupplyJob.status, func.count()).where(SupplyJob.entity_id == eid).group_by(SupplyJob.status)).all())
    today = dt.date.today()
    month_start = today.replace(day=1)
    confirmed = db.scalars(select(SupplyJob).where(SupplyJob.entity_id == eid, SupplyJob.status == "confirmed", SupplyJob.job_date >= month_start)).all()
    items = db.scalar(select(func.count()).select_from(PriceItem).where(PriceItem.entity_id == eid, PriceItem.archived_at.is_(None))) or 0
    from app.modkit.models import EntityActivity

    last_price = db.scalar(select(func.max(EntityActivity.created_at)).where(EntityActivity.entity_id == eid, EntityActivity.kind == "price_changed"))
    return {
        "jobs": sum(counts.values()), "draft": counts.get("draft", 0), "submitted": counts.get("submitted", 0),
        "disputed": counts.get("disputed", 0), "confirmed": counts.get("confirmed", 0),
        "month_cost": round(sum(_basis(j, access.entity.vat_in_cost) for j in confirmed), 2),
        "price_items": items, "last_price_change": last_price.isoformat() + "Z" if last_price else None,
    }


def _cost_split(db: Session, jobs: list[SupplyJob], vat_in_cost: bool) -> dict[int, dict[str, float]]:
    """Onaylanmış işlerin maliyeti (gerçek tutar varsa o, yoksa tahmin; KDV ayarına göre) malzeme / hizmet / sabit ücret olarak bölünür.
    Oran, tahmin satırlarının türünden (fiyat listesi kalemi: malzeme, hizmet, sabit ücret/minimum; kalemsiz satır hizmet) ve onay
    anındaki ürün malzemesi tahmininden gelir; tutar bu oranla paylaştırılır, yani faturada yalnızca toplam olsa da dağılım çıkar."""
    kinds: dict[int, dict[str, float]] = {}
    if jobs:
        rows = db.execute(
            select(SupplyJobLine.job_id, PriceItem.kind, func.sum(SupplyJobLine.amount))
            .outerjoin(PriceItem, PriceItem.id == SupplyJobLine.price_item_id)
            .where(SupplyJobLine.job_id.in_([j.id for j in jobs])).group_by(SupplyJobLine.job_id, PriceItem.kind)
        ).all()
        for job_id, kind, amount in rows:
            bucket = {"material": "material", "fee": "fee", "minimum": "fee"}.get(kind or "", "service")
            kinds.setdefault(job_id, {}).update({bucket: kinds.get(job_id, {}).get(bucket, 0.0) + (amount or 0.0)})
    out: dict[int, dict[str, float]] = {}
    for j in jobs:
        parts = {"material": 0.0, "service": 0.0, "fee": 0.0, **kinds.get(j.id, {})}
        parts["material"] += j.material_cost or 0.0
        total = sum(parts.values())
        basis = _basis(j, vat_in_cost)
        out[j.id] = {k: basis * (v / total if total else (1.0 if k == "service" else 0.0)) for k, v in parts.items()}
    return out


def report(db: Session, access: EntityAccess, start: dt.date, end: dt.date) -> dict:
    eid = access.entity.id
    jobs = db.scalars(select(SupplyJob).where(SupplyJob.entity_id == eid, SupplyJob.job_date >= start, SupplyJob.job_date <= end)).all()
    vat_in_cost = access.entity.vat_in_cost
    confirmed = [j for j in jobs if j.status == "confirmed"]
    months: dict[str, dict] = {}
    split_ = _cost_split(db, confirmed, vat_in_cost)
    for j in confirmed:
        k = j.job_date.strftime("%Y-%m")
        m = months.setdefault(k, {"month": k, "cost": 0.0, "estimate": 0.0, "actual": 0.0, "jobs": 0, "material": 0.0, "service": 0.0, "fee": 0.0})
        for part, value in split_[j.id].items():
            m[part] = round(m[part] + value, 2)
        m["cost"] = round(m["cost"] + _basis(j, vat_in_cost), 2)
        m["estimate"] = round(m["estimate"] + (j.estimate or 0), 2)
        m["actual"] = round(m["actual"] + (j.actual if j.actual is not None else j.estimate or 0), 2)
        m["jobs"] += 1
    with_actual = [j for j in confirmed if j.actual is not None and j.estimate]
    usage = []
    ids = [j.id for j in confirmed]
    if ids:
        rows = db.execute(
            select(SupplyJobLine.price_item_id, SupplyJobLine.description, SupplyJobLine.unit, func.sum(SupplyJobLine.qty), func.sum(SupplyJobLine.amount))
            .where(SupplyJobLine.job_id.in_(ids)).group_by(SupplyJobLine.price_item_id, SupplyJobLine.description, SupplyJobLine.unit)
        ).all()
        for iid, desc, unit, qty, amount in sorted(rows, key=lambda r: -(r[4] or 0))[:50]:
            usage.append({"price_item_id": iid, "description": desc, "unit": unit, "qty": round(qty or 0, 3), "amount": round(amount or 0, 2),
                          "avg_unit_price": round((amount or 0) / qty, 4) if qty else None})
    return {
        "currency": access.entity.currency, "jobs": len(jobs), "confirmed": len(confirmed),
        "cost": round(sum(_basis(j, vat_in_cost) for j in confirmed), 2),
        "estimate_total": round(sum(j.estimate or 0 for j in with_actual), 2),
        "actual_total": round(sum(j.actual or 0 for j in with_actual), 2),
        "material": round(sum(m["material"] for m in months.values()), 2), "service": round(sum(m["service"] for m in months.values()), 2),
        "fee": round(sum(m["fee"] for m in months.values()), 2),
        "months": [months[k] for k in sorted(months)], "usage": usage,
    }


def item_in_use(db: Session, item_id: int) -> bool:
    return db.scalar(select(SupplyJobLine.id).where(SupplyJobLine.price_item_id == item_id).limit(1)) is not None

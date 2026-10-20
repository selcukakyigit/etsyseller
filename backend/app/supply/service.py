"""Dış Tedarik işleri.

Bir işin iki tutarı vardır:
    tahmin  — fiyat listesinden: belgeden okunan ölçüler (ör. kesim süresi) eşlendikleri kalemlerle çarpılır.
    gerçek  — tedarikçinin istediği (belgede yazan ya da elle girilen), KDV hariç.
Maliyet olarak gerçek tutar kullanılır; girilmediyse tahmin. KDV, kayıtta "KDV maliyete dahil" seçiliyse eklenir.

Durumlar: taslak → (tedarikçi gönderir) gönderildi → (satıcı) onaylandı | itiraz edildi. Onaylanan iş değişmez;
satıcı yeniden açabilir. Onayda dağıtım planı `supply_allocations` satırlarına dönüşür: ürüne düşen pay ürünün birim
maliyeti olarak uygulanabilir, genel gidere düşen pay Finans raporundaki giderlere girer."""
import datetime as dt

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modkit import activity, documents, mailer, pricebook, pricing, units
from app.modkit.access import EntityAccess
from app.modkit.models import EntityDocument, FieldMapping, PriceItem
from app.supply import profile as doc_profile
from app.supply import weights
from app.supply.models import SupplyAllocation, SupplyJob, SupplyJobDocument, SupplyJobLine
from app.supply.plan import plan_of

MODULE = "supply"
MAX_LINES = 200
MAX_DOCUMENTS = 30
MAX_JOBS_PER_ENTITY = 20000
MAX_QTY = 1e9


def utcnow() -> dt.datetime:
    return dt.datetime.utcnow()


def job_when(job: SupplyJob) -> dt.datetime:
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


# --------------------------------------------------------------- işin belgeleri ----

def job_documents(db: Session, job: SupplyJob) -> list[EntityDocument]:
    return list(db.scalars(
        select(EntityDocument).join(SupplyJobDocument, SupplyJobDocument.document_id == EntityDocument.id)
        .where(SupplyJobDocument.job_id == job.id).order_by(SupplyJobDocument.position, SupplyJobDocument.id)
    ))


def job_data(db: Session, job: SupplyJob) -> dict | None:
    """İşin tüm belgelerinin okunmuş verisi, toplanmış (`profile.merge`); okunmuş belge yoksa None. Ölçüler, satırlar ve plaka toplamları
    (kesim uzunluğu, delme, süreler) iş genelinde bu veriden okunur."""
    return doc_profile.merge([d for d in (documents.data_of(x) for x in job_documents(db, job)) if d])


def link_document(db: Session, job: SupplyJob, doc: EntityDocument) -> None:
    """Belgeyi işe bağlar (zaten bağlıysa bir şey yapmaz). Belge, işin kaydından olmalıdır (çağıran `documents.get` ile alır)."""
    if doc.entity_id != job.entity_id:
        raise HTTPException(404, "Belge bulunamadı")
    if db.scalar(select(SupplyJobDocument.id).where(SupplyJobDocument.job_id == job.id, SupplyJobDocument.document_id == doc.id)):
        return
    n = db.scalar(select(func.count()).select_from(SupplyJobDocument).where(SupplyJobDocument.job_id == job.id)) or 0
    if n >= MAX_DOCUMENTS:
        raise HTTPException(422, "Belge sınırına ulaşıldı")
    db.add(SupplyJobDocument(job_id=job.id, document_id=doc.id, position=n))
    db.flush()


def _sync_actual(db: Session, job: SupplyJob, old_net: float | None) -> None:
    """Gerçek tutar belgelerin KDV hariç toplamından geliyorsa (boş ya da önceki toplamla aynı) yeni toplama güncellenir; elle yazılmışsa dokunulmaz."""
    if job.actual is None or (old_net is not None and abs(job.actual - old_net) < 0.005):
        job.actual = (job_data(db, job) or {}).get("net")


# --------------------------------------------------------------- serileştirme ----

def job_basis(job: SupplyJob, vat_in_cost: bool) -> float:
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
    return pricing.totals([ln.amount for ln in lines], _min_price(db, job.entity_id, job_when(job)), job.vat_rate)


def serialize_job(db: Session, access: EntityAccess, job: SupplyJob, detail: bool = False) -> dict:
    vat_in_cost = access.entity.vat_in_cost
    out = {
        "id": job.id, "number": job.number, "title": job.title, "job_date": job.job_date.isoformat(), "status": job.status,
        "currency": job.currency, "vat_rate": job.vat_rate, "estimate": job.estimate, "actual": job.actual,
        "basis": job_basis(job, vat_in_cost), "created_via": job.created_via,
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
        "documents": [documents.serialize(d) for d in job_documents(db, job)],
        "document_data": job_data(db, job),  # belgelerin toplanmış hâli (ölçüler, tutar satırları)
    })
    if access.internal:  # ürün dağıtımı ve olası mükerrerler iç bilgidir, tedarikçi görmez
        out["similar"] = similar_jobs(db, job)
        out["plan"] = plan_of(job)
        materials_total = material_summary(db, access, job)
        if materials_total is not None:
            out["materials"] = materials_total
            if job.actual is not None:  # kesimci malzemeyi de veriyorsa gerçek tutar lazer + malzeme tahminiyle karşılaştırılır
                out["diff"] = round(job.actual - job.estimate - materials_total["total"], 2)
        out.update({"time_fee": job.time_fee, "time_fee_mapped": mapped_time_fee(db, job), "with_material": job.with_material,
                    "times": [{"key": m["key"], "label": m["label"], "seconds": m["value"]} for m in _time_measures(db, job)]})
        out["allocations"] = [
            {"id": a.id, "shop_id": a.shop_id, "party_id": a.party_id, "listing_id": a.listing_id, "variant": a.variant, "title": a.title, "qty": a.qty, "amount": a.amount,
             "amount_report": a.amount_report, "report_ccy": a.report_ccy, "applied_at": a.applied_at.isoformat() + "Z" if a.applied_at else None}
            for a in db.scalars(select(SupplyAllocation).where(SupplyAllocation.job_id == job.id).order_by(SupplyAllocation.id))
        ]
    return out


def _time_measures(db: Session, job: SupplyJob) -> list[dict]:
    """Belgedeki süre ölçüleri (saniye): rapor hem kesim hem işlem süresi verebilir, hangisinin faturalandığı kullanıcıya gösterilir."""
    data = job_data(db, job)
    return [m for m in data["measures"] if m["unit"] == "s"] if data else []


def mapped_time_fee(db: Session, job: SupplyJob) -> float | None:
    """Süre ölçüsünden fiyat listesine eşlenmiş satırların toplamı (lazer süre bedeli tahmini); eşlenmiş satır yoksa None."""
    keys = {m["key"] for m in _time_measures(db, job)}
    amounts = [ln.amount for ln in _lines(db, job.id) if ln.source_key in keys and ln.amount is not None]
    return round(sum(amounts), 2) if amounts else None


def material_summary(db: Session, access: EntityAccess, job: SupplyJob) -> dict | None:
    """Dağıtım hedeflerinin (adet dahil) kullandığı malzeme, malzeme kalemi başına toplanmış: {"total", "items": [{name, type,
    thickness, kg, cost}]}. Malzeme kesimciden değilse ya da maliyet hesaplanamıyorsa None."""
    plan = plan_of(job)
    if not job.with_material or not plan["targets"]:
        return None
    items: dict[tuple, dict] = {}
    for target, usage in zip(plan["targets"], weights.material_usage(db, access, plan["targets"], job_when(job))):
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
    return [{"price_item_id": i.id, "description": i.name, "qty": 1.0 if i.kind == "fee" else i.auto_qty, "unit": "job" if i.unit == pricebook.PERCENT else i.unit,
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
            created_by=access.user.id, created_via="guest" if access.is_guest else "owner",
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
    lines = _auto_lines(db, access.entity.id, job_when(job))
    if document is not None:
        link_document(db, job, document)
    if data is not None:
        lines = build_lines_from_document(db, access, data, job_when(job)) + lines
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
    prices = pricebook.prices_at(db, list(items), job_when(job))
    out = []
    for r in raw:
        qty = _clean_qty(r.get("qty", 1))
        manual = bool(r.get("manual_price"))
        item = items.get(int(r["price_item_id"])) if r.get("price_item_id") else None
        if item is not None:
            unit = "job" if item.unit == pricebook.PERCENT else item.unit
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


def _apply_percent(db: Session, job: SupplyJob, lines: list[dict]) -> bool:
    """Yüzdelik sabit ücret satırlarının (kalem birimi "pct", elle değilse) tutarını hesaplar: işin hizmet ve malzeme satırlarının (sabit ücretler ve minimum
    hariç, kalemsiz satırlar dahil) toplamının yüzdesi, kalemin "en az" tutarından küçükse o; yüzde işin tarihindeki fiyat sürümünden gelir. Satırların
    `unit_price` ve `unit` alanı yerinde güncellenir; bir satır değiştiyse True. Gerçek tutar (tedarikçinin faturası) girilmişse yeniden hesaplanmaz, o zaten toplamdır."""
    ids = {ln["price_item_id"] for ln in lines if ln.get("price_item_id")}
    if not ids:
        return False
    items = {i.id: i for i in db.scalars(select(PriceItem).where(PriceItem.id.in_(ids)))}
    pct = [ln for ln in lines if (i := items.get(ln.get("price_item_id"))) is not None and i.unit == pricebook.PERCENT and not ln.get("manual_price")]
    if not pct:
        return False
    base = sum(pricing.line_amount(ln["qty"], ln["unit_price"]) for ln in lines
               if (i := items.get(ln.get("price_item_id"))) is None or i.kind not in ("fee", "minimum"))
    prices = pricebook.prices_at(db, [ln["price_item_id"] for ln in pct], job_when(job))
    changed = False
    for ln in pct:
        item, version = items[ln["price_item_id"]], prices.get(ln["price_item_id"])
        amount = pricing.percent_fee(base, version.price if version else 0.0, item.min_amount)
        changed = changed or abs(ln["unit_price"] - amount) > 1e-9
        ln["unit_price"], ln["unit"] = amount, "job"
    return changed


def _write_lines(db: Session, job: SupplyJob, lines: list[dict]) -> None:
    _apply_percent(db, job, lines)
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
    job.updated_at = utcnow()  # tutar aynı kalsa da değişiklik görünsün (ön yüz düzenleyicileri buna göre tazelenir)


def refresh_prices(db: Session, job: SupplyJob) -> None:
    """Taslak işte fiyat listesine bağlı (elle olmayan) satırların fiyatı, işin tarihindeki güncel fiyatla tazelenir: liste fiyatı
    değişince ya da geçmişe tarihli düzeltilince açık işler kendiliğinden doğru tutarı gösterir. Onaylanmış işe dokunulmaz."""
    if job.status not in ("draft", "disputed"):
        return
    current = _lines(db, job.id)
    lines = [ln for ln in current if ln.price_item_id and not ln.manual_price]
    prices = pricebook.prices_at(db, list({ln.price_item_id for ln in lines}), job_when(job))
    percent_ids = set(db.scalars(select(PriceItem.id).where(PriceItem.id.in_(list(prices)), PriceItem.unit == pricebook.PERCENT))) if prices else set()
    stale = [ln for ln in lines if ln.price_item_id in prices and ln.price_item_id not in percent_ids and abs(prices[ln.price_item_id].price - ln.unit_price) > 1e-9]
    for ln in stale:
        ln.unit_price = prices[ln.price_item_id].price
        ln.amount = pricing.line_amount(ln.qty, ln.unit_price)
    # yüzdelik ücretler diğer satırların toplamına ve yüzde fiyatına bağlıdır: onlar da yeniden hesaplanır
    calc = [{"price_item_id": ln.price_item_id, "qty": ln.qty, "unit_price": ln.unit_price, "manual_price": ln.manual_price} for ln in current]
    percent_changed = _apply_percent(db, job, calc)
    if percent_changed:
        for ln, c in zip(current, calc):
            if ln.price_item_id in percent_ids and not ln.manual_price:
                ln.unit_price, ln.unit = c["unit_price"], c["unit"]
                ln.amount = pricing.line_amount(ln.qty, ln.unit_price)
    if not stale and not percent_changed:
        return
    db.flush()
    job.estimate = _totals(db, job, _lines(db, job.id)).net
    job.updated_at = utcnow()
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


def _rebuild_lines(db: Session, access: EntityAccess, job: SupplyJob) -> None:
    """Belgeden gelen satırlar işin belgelerinin toplanmış verisinden yeniden kurulur (belge kalmadıysa hiç), elle eklenenler korunur."""
    data = job_data(db, job)
    keep = [{"price_item_id": ln.price_item_id, "description": ln.description, "qty": ln.qty, "unit": ln.unit, "unit_price": ln.unit_price,
             "manual_price": ln.manual_price, "source_key": ""}
            for ln in _lines(db, job.id) if not ln.source_key]
    _write_lines(db, job, (build_lines_from_document(db, access, data, job_when(job)) if data else []) + keep)
    activity.log(db, access.entity.id, access.user, "job_lines_changed", {"number": job.number})


def rebuild_from_document(db: Session, access: EntityAccess, job: SupplyJob) -> None:
    """Eşlemeler değişti: belgeden gelen satırlar yeniden kurulur, elle eklenen satırlar korunur."""
    _require_editable(access, job)
    if job_data(db, job) is None:
        raise HTTPException(409, "Bu işin okunmuş bir belgesi yok")
    _rebuild_lines(db, access, job)
    db.commit()


def detach_document(db: Session, access: EntityAccess, job: SupplyJob, doc_id: int) -> None:
    """Belgeyi işten çıkarır: onun katkısı (ölçüler, satırlar, belgeden gelen gerçek tutar) düşer; elle eklenen satırlar kalır. Belgenin
    kendisi Belgeler sekmesinde durur."""
    _require_editable(access, job)
    link = db.scalar(select(SupplyJobDocument).where(SupplyJobDocument.job_id == job.id, SupplyJobDocument.document_id == doc_id))
    if link is None:
        raise HTTPException(404, "Belge bulunamadı")
    old_net = (job_data(db, job) or {}).get("net")
    db.delete(link)
    db.flush()
    _sync_actual(db, job, old_net)
    _rebuild_lines(db, access, job)
    activity.log(db, access.entity.id, access.user, "job_document_removed", {"number": job.number})
    db.commit()


def remove_document_item(db: Session, access: EntityAccess, job: SupplyJob, kind: str, key: str) -> None:
    """Belgelerden okunan bir ölçüyü ("measure") ya da tutar satırını ("line") okunan veriden siler (yanlış okunmuş ya da gereksiz);
    anahtar hangi belgede varsa oradan çıkar, satırlar yeniden kurulur."""
    _require_editable(access, job)
    if kind not in ("measure", "line"):
        raise HTTPException(422, "Geçersiz tür")
    docs = job_documents(db, job)
    if not any(documents.data_of(d) for d in docs):
        raise HTTPException(409, "Bu işin okunmuş bir belgesi yok")
    for doc in docs:
        data = documents.data_of(doc)
        if data is not None:
            documents.set_result(doc, doc_profile.without(data, kind, key), doc.extract_source)
    activity.log(db, access.entity.id, access.user, "job_document_item_removed", {"number": job.number})
    db.flush()
    _rebuild_lines(db, access, job)
    db.commit()


def attach_analysis(db: Session, access: EntityAccess, doc: EntityDocument, data: dict | None, source: str,
                    create: bool, job_id: int | None) -> SupplyJob | None:
    """Okunan belgeyi kaydeder; istenirse yeni iş açar ya da var olan işe ekler (işin diğer belgeleri kalır, ölçüler toplanır)."""
    documents.set_result(doc, data, source)
    activity.log(db, access.entity.id, access.user, "document_added", {"filename": doc.filename, "source": source})
    if job_id is not None:
        job = get_job(db, access, job_id)
        _require_editable(access, job)
        old_net = (job_data(db, job) or {}).get("net")
        link_document(db, job, doc)
        if data is None:
            db.commit()
            return job
        db.flush()
        _sync_actual(db, job, old_net)
        rebuild_from_document(db, access, job)
        return job
    if create and data is not None:
        return job_for_document(db, access, doc) or job_from_document(db, access, doc, data)
    db.commit()
    return None


def job_for_document(db: Session, access: EntityAccess, doc: EntityDocument) -> SupplyJob | None:
    """Belgeden açılmış iş varsa o (aynı belgeden ikinci iş açılmasın)."""
    return db.scalars(
        select(SupplyJob).join(SupplyJobDocument, SupplyJobDocument.job_id == SupplyJob.id)
        .where(SupplyJob.entity_id == access.entity.id, SupplyJobDocument.document_id == doc.id).order_by(SupplyJob.number).limit(1)
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


# --------------------------------------------------------------- dağıtım ----


# ---- belge satırlarından ürün önerisi


# --------------------------------------------------------------- özet ve rapor ----


def item_in_use(db: Session, item_id: int) -> bool:
    return db.scalar(select(SupplyJobLine.id).where(SupplyJobLine.price_item_id == item_id).limit(1)) is not None

"""Dış Tedarik özet ve dönem raporu: iş sayıları, aylık maliyet, malzeme / hizmet / sabit ücret dağılımı, kalem kullanımı, dış paylar."""
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modkit.access import EntityAccess
from app.modkit.models import ExternalParty, PriceItem
from app.supply.models import SupplyAllocation, SupplyJob, SupplyJobLine
from app.supply.service import job_basis


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
        "month_cost": round(sum(job_basis(j, access.entity.vat_in_cost) for j in confirmed), 2),
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
        basis = job_basis(j, vat_in_cost)
        out[j.id] = {k: basis * (v / total if total else (1.0 if k == "service" else 0.0)) for k, v in parts.items()}
    return out


def report(db: Session, access: EntityAccess, start: dt.date | None = None, end: dt.date | None = None) -> dict:
    """Dönem raporu; tarih verilmezse tüm zamanlar. `statuses`: dönemdeki işlerin durum sayıları."""
    eid = access.entity.id
    query = select(SupplyJob).where(SupplyJob.entity_id == eid)
    if start is not None and end is not None:
        query = query.where(SupplyJob.job_date >= start, SupplyJob.job_date <= end)
    jobs = db.scalars(query).all()
    vat_in_cost = access.entity.vat_in_cost
    confirmed = [j for j in jobs if j.status == "confirmed"]
    months: dict[str, dict] = {}
    split_ = _cost_split(db, confirmed, vat_in_cost)
    for j in confirmed:
        k = j.job_date.strftime("%Y-%m")
        m = months.setdefault(k, {"month": k, "cost": 0.0, "estimate": 0.0, "actual": 0.0, "jobs": 0, "material": 0.0, "service": 0.0, "fee": 0.0})
        for part, value in split_[j.id].items():
            m[part] = round(m[part] + value, 2)
        m["cost"] = round(m["cost"] + job_basis(j, vat_in_cost), 2)
        m["estimate"] = round(m["estimate"] + (j.estimate or 0), 2)
        m["actual"] = round(m["actual"] + (j.actual if j.actual is not None else j.estimate or 0), 2)
        m["jobs"] += 1
    with_actual = [j for j in confirmed if j.actual is not None and j.estimate]
    usage, external = [], []
    ids = [j.id for j in confirmed]
    if ids:
        external = [{"party_id": pid, "name": name, "amount": round(amount or 0, 2), "jobs": n} for pid, name, amount, n in db.execute(
            select(ExternalParty.id, ExternalParty.name, func.sum(SupplyAllocation.amount), func.count(func.distinct(SupplyAllocation.job_id)))
            .join(SupplyAllocation, SupplyAllocation.party_id == ExternalParty.id).where(SupplyAllocation.job_id.in_(ids))
            .group_by(ExternalParty.id, ExternalParty.name).order_by(ExternalParty.name)
        ).all()]
        rows = db.execute(
            select(SupplyJobLine.price_item_id, SupplyJobLine.description, SupplyJobLine.unit, func.sum(SupplyJobLine.qty), func.sum(SupplyJobLine.amount))
            .where(SupplyJobLine.job_id.in_(ids)).group_by(SupplyJobLine.price_item_id, SupplyJobLine.description, SupplyJobLine.unit)
        ).all()
        for iid, desc, unit, qty, amount in sorted(rows, key=lambda r: -(r[4] or 0))[:50]:
            usage.append({"price_item_id": iid, "description": desc, "unit": unit, "qty": round(qty or 0, 3), "amount": round(amount or 0, 2),
                          "avg_unit_price": round((amount or 0) / qty, 4) if qty else None})
    return {
        "currency": access.entity.currency, "jobs": len(jobs), "confirmed": len(confirmed),
        "statuses": {s: sum(1 for j in jobs if j.status == s) for s in ("draft", "submitted", "disputed", "confirmed")},
        "cost": round(sum(job_basis(j, vat_in_cost) for j in confirmed), 2),
        "estimate_total": round(sum(j.estimate or 0 for j in with_actual), 2),
        "actual_total": round(sum(j.actual or 0 for j in with_actual), 2),
        "material": round(sum(m["material"] for m in months.values()), 2), "service": round(sum(m["service"] for m in months.values()), 2),
        "fee": round(sum(m["fee"] for m in months.values()), 2),
        "months": [months[k] for k in sorted(months)], "usage": usage, "external": external,
    }

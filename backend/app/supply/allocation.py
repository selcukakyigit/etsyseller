"""Dış Tedarik maliyet dağıtımı: işin tutarının ürünlere, genel gidere ve dış paylara bölünmesi, onay / yeniden açma, Finans'a ürün birim
maliyeti olarak yazma ve geri alma.

Plan (`plan.py`) kaydedilir, önizlenir; onayda `supply_allocations` satırlarına dönüşür. Her mağaza payı o mağazanın rapor para birimine işin
tarihindeki kurla çevrilir (`fx.py`); dış paylar mağazasızdır ve maliyete / Finans'a girmez."""
import json

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.i18n import tr
from app.listings.models import ListingCache
from app.modkit import activity, documents, materials, parties, pricebook, products, units
from app.modkit.access import EntityAccess
from app.modkit.models import EntityDocument, ModuleEntity
from app.modkit.numbers import DIMS, slug
from app.shops.models import Shop
from app.supply import fx, paint, weights
from app.supply import profile as doc_profile
from app.supply.models import SupplyAllocation, SupplyJob
from app.supply.plan import ESTIMATED, MAX_TARGETS, SPLIT_MODES, plan_of
from app.supply.service import MODULE, job_basis, job_when, material_summary, mapped_time_fee, similar_jobs, utcnow


def confirm(db: Session, access: EntityAccess, job: SupplyJob, allow_duplicate: bool = False) -> None:
    access.require_member()
    if job.status == "confirmed":
        return
    twin = next((s for s in similar_jobs(db, job) if s["status"] == "confirmed"), None)
    if twin and not allow_duplicate:  # aynı maliyet iki kez Finans'a yazılmasın
        raise HTTPException(409, tr(f"Aynı tarih ve tutarda onaylanmış bir iş var (#{twin['number']}). Mükerrer olabilir; yine de onaylamak için onayı tekrarla.",
                                    f"A confirmed job with the same date and amount exists (#{twin['number']}). It may be a duplicate; confirm again to proceed anyway."))
    plan = plan_of(job)
    if not plan["targets"]:
        raise HTTPException(422, "Onaylamadan önce maliyetin nereye yazılacağını seç (ürünler ya da genel gider).")
    basis = job_basis(job, access.entity.vat_in_cost)
    if basis <= 0:
        raise HTTPException(422, "İşin tutarı sıfır; satır ekle ya da gerçek tutarı gir.")
    amounts = split(db, access, job, basis, plan)
    _materialize(db, access, job, plan, amounts, basis)
    summary_ = material_summary(db, access, job)
    job.material_cost = summary_["total"] if summary_ else None
    job.status = "confirmed"
    job.confirmed_at = utcnow()
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


def set_plan(db: Session, access: EntityAccess, job: SupplyJob, mode: str, targets: list[dict], remainder_party_id: int | None = None) -> dict:
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
        if t.get("party_id"):  # dış pay: mağazalara yazılmaz, tutar elle ya da adetle belirlenir
            party = parties.get(db, access.entity.workspace_id, int(t["party_id"]))
            key = ("party", party.id)
            if key in seen:
                raise HTTPException(422, "Aynı hedef iki kez seçilmiş")
            seen.add(key)
            amount = pricebook.clean_price(t.get("amount")) if mode == "manual" else None
            clean.append({"shop_id": None, "party_id": party.id, "listing_id": None, "variant": "", "title": party.name, "qty": max(1, int(t.get("qty") or 1)),
                          "price": 0.0, "amount": amount, "item_id": None})
            continue
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
        clean.append({"shop_id": shop_id, "party_id": None, "listing_id": listing_id, "variant": variant, "title": title, "qty": qty, "price": price,
                      "amount": amount if mode == "manual" else None, "item_id": paint.clean_item(db, access, t.get("item_id")) if mode == paint.MODE else None})
    if mode == "price" and any(c["listing_id"] is None for c in clean) and any(c["listing_id"] is not None for c in clean):
        raise HTTPException(422, "Fiyat payına göre bölüştürmede genel gider seçilemez; 'adet' ya da 'elle' bölüştür.")
    if (mode in weights.WEIGHT_MODES or mode in (ESTIMATED, paint.MODE)) and any(c["listing_id"] is None for c in clean):
        raise HTTPException(422, "Ölçüye göre bölüştürmede genel gider seçilemez; 'adet' ya da 'elle' bölüştür.")
    if mode == paint.MODE:
        paint.remember(db, access, [c for c in clean if c["party_id"] is None])
    if remainder_party_id is not None:  # yalnızca dağıtılmayan kalanı olan türlerde anlamlıdır
        parties.get(db, access.entity.workspace_id, remainder_party_id)
        if mode not in (ESTIMATED, paint.MODE):
            remainder_party_id = None
    job.allocation_plan = json.dumps({"mode": mode, "targets": clean, "remainder_party_id": remainder_party_id}, ensure_ascii=False)
    job.updated_at = utcnow()
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
    return weights.estimates(db, access, plan["targets"], fee or 1.0, job.with_material, job_when(job), _doc_total(db, job, "cut_length"))


def split(db: Session, access: EntityAccess, job: SupplyJob, basis: float, plan: dict) -> list[float]:
    """Tutarı hedeflere böler; kuruş farkı son hedefe yazılır (toplam her zaman tutara eşit)."""
    targets = plan["targets"]
    if not targets:
        return []
    rest = 0.0
    if plan["mode"] == paint.MODE:  # m² fiyatından hesaplanır; tutara eşitlenmez
        return paint.amounts(db, access, targets, job_when(job))[0]
    if plan["mode"] == "manual":
        amounts = [round(float(t.get("amount") or 0), 2) for t in targets]
        if abs(sum(amounts) - basis) > 0.05:
            raise HTTPException(422, tr(f"Elle girilen tutarların toplamı ({sum(amounts):.2f}) işin tutarına ({basis:.2f}) eşit olmalı.",
                                        f"The manual amounts add up to {sum(amounts):.2f}; they must equal the job amount ({basis:.2f})."))
        amounts[-1] = round(basis - sum(amounts[:-1]), 2)
        return amounts
    if plan["mode"] == "price":
        shares = [(t.get("price") or 0) * t["qty"] for t in targets]
        if not any(shares):  # fiyat bilinmiyorsa adede göre
            shares = [t["qty"] for t in targets]
    elif plan["mode"] in weights.WEIGHT_MODES:
        shares = weights.weights(db, access, targets, plan["mode"])
    elif plan["mode"] == ESTIMATED:
        rows, rest = _estimates(db, access, job, plan)
        shares = [e["laser"] + e["material"] for e in rows]
    else:
        shares = [t["qty"] for t in targets]
    total = (sum(shares) + rest) or 1
    amounts = [round(basis * w / total, 2) for w in shares]
    if not rest:  # plakanın seçilmeyen kısmı varsa o pay dağıtılmaz (toplam tutardan küçük kalır); yoksa kuruş farkı son hedefe
        amounts[-1] = round(basis - sum(amounts[:-1]), 2)
    return amounts


def _remainder(plan: dict, basis: float, amounts: list[float]) -> float:
    """İşin tutarından hedeflere dağıtılmayan kısım (yalnızca dış pay sahibi seçilmişse yazılır; kuruş altı sayılmaz)."""
    rest = round(basis - sum(amounts), 2)
    return rest if plan.get("remainder_party_id") and rest > 0.005 else 0.0


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
            rate = fx.rate(job.currency, ccy, job.job_date)
        except HTTPException:
            out.append(None)
            continue
        out.append(None if ccy == job.currency else {"amount": round(amount * rate, 2), "currency": ccy, "rate": rate})
    return out


def preview(db: Session, access: EntityAccess, job: SupplyJob) -> dict:
    access.require_member()
    plan = plan_of(job)
    basis = job_basis(job, access.entity.vat_in_cost)
    try:
        amounts = split(db, access, job, basis, plan) if plan["targets"] else []
        estimate = _estimates(db, access, job, plan)[0] if plan["mode"] == ESTIMATED and plan["targets"] else []
        error = None
    except HTTPException as exc:
        amounts, estimate, error = [], [], str(exc.detail)
    usage = weights.material_usage(db, access, plan["targets"], job_when(job)) if plan["targets"] else []
    reports = _report_amounts(db, access, job, plan, amounts)
    paint_ids = [i.id if i else None for i in paint.items_for(db, access, plan["targets"])] if plan["mode"] == paint.MODE else None  # seçilmiş, kayıtlı ya da tek uygun kalem
    return {"mode": plan["mode"], "basis": basis, "currency": job.currency, "error": error,
            "remainder": {"party_id": plan["remainder_party_id"], "amount": _remainder(plan, basis, amounts)} if plan["remainder_party_id"] else None,
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
        actual = sum(weights.weights(db, access, plan["targets"], measure))
    except HTTPException:
        return None
    return {"measure": measure, "expected": round(expected, 1), "actual": round(actual, 1), "diff_pct": round((actual - expected) / expected * 100, 1)}


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


def _materialize(db: Session, access: EntityAccess, job: SupplyJob, plan: dict, amounts: list[float], basis: float) -> None:
    """Planı dağıtım satırlarına çevirir; her mağaza payı o mağazanın rapor para birimine işin tarihindeki kurla çevrilir. Dış paylar (ve
    dağıtılmayan kalan için seçilen dış pay sahibi) mağazasızdır: iş para biriminde yazılır, maliyete ve Finans'a girmez."""
    from app.finance import service as finance_service

    db.execute(delete(SupplyAllocation).where(SupplyAllocation.job_id == job.id))
    shops = products.workspace_shops(db, access.entity.workspace_id)

    def external(party_id: int, title: str, amount: float, qty: int = 1) -> None:
        db.add(SupplyAllocation(job_id=job.id, shop_id=None, party_id=party_id, listing_id=None, variant="", title=title, qty=qty, amount=amount,
                                amount_report=amount, report_ccy=job.currency, fx_rate=1.0))

    for t, amount in zip(plan["targets"], amounts):
        if t.get("party_id"):
            external(t["party_id"], t.get("title") or "", amount, t["qty"])
            continue
        shop = shops.get(t["shop_id"])
        if shop is None:
            raise HTTPException(404, "Mağaza bulunamadı")
        report_ccy = finance_service.report_currency(db, shop)
        rate = fx.rate(job.currency, report_ccy, job.job_date)
        db.add(SupplyAllocation(
            job_id=job.id, shop_id=shop.id, listing_id=t["listing_id"], variant=t.get("variant") or "", title=t.get("title") or "", qty=t["qty"],
            amount=amount, amount_report=round(amount * rate, 4), report_ccy=report_ccy, fx_rate=rate,
        ))
    rest = _remainder(plan, basis, amounts)
    if rest:
        party = parties.get(db, access.entity.workspace_id, plan["remainder_party_id"])
        external(party.id, party.name, rest)


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
    a.applied_at = utcnow()
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

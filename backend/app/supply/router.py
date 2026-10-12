"""Dış Tedarik uç noktaları. Kayıt, fiyat listesi, belge listesi, paylaşım ve akış ortak router'dan miras gelir
(modkit/routes.py); burada yalnızca işler, dağıtım ve belge okuma vardır."""
import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.billing.metering import set_scope
from app.core.db import get_db
from app.core.i18n import translate_detail
from app.modkit import analyzer, documents, ratelimit
from app.modkit.access import EntityAccess, entity_access
from app.modkit.routes import build_entity_router
from app.shops.deps import check_ai_allowed
from app.supply import profile as doc_profile
from app.supply import allocation, packages, plan, reports, service
from app.supply.models import JOB_STATUSES

base_router = build_entity_router(module=service.MODULE, prefix="/api/supply", tag="supply", item_in_use=service.item_in_use, summary=reports.summary)
router = APIRouter(prefix="/api/supply", tags=["supply"])
access_dep = entity_access(service.MODULE)


class JobIn(BaseModel):
    title: str = Field("", max_length=200)
    job_date: dt.date | None = None
    note: str = Field("", max_length=5000)


class JobPatch(BaseModel):
    title: str | None = Field(None, max_length=200)
    job_date: dt.date | None = None
    note: str | None = Field(None, max_length=5000)
    vat_rate: float | None = Field(None, ge=0, le=100)
    actual: float | None = Field(None, ge=0)
    time_fee: float | None = Field(None, ge=0, le=1e9)
    with_material: bool | None = None


class LineIn(BaseModel):
    price_item_id: int | None = None
    description: str = Field("", max_length=200)
    qty: float = Field(1, ge=0, le=1e9)
    unit: str = Field("piece", max_length=10)
    unit_price: float | None = Field(None, ge=0)
    manual_price: bool = False
    source_key: str = Field("", max_length=120)


class LinesIn(BaseModel):
    lines: list[LineIn] = Field(max_length=service.MAX_LINES)


class DisputeIn(BaseModel):
    note: str = Field("", max_length=500)


class TargetIn(BaseModel):
    shop_id: int = 0  # dış payda 0 (party_id verilir)
    party_id: int | None = None  # dış pay sahibi (modkit/parties); mağazaya yazılmaz
    listing_id: int | None = None
    variant: str = Field("", max_length=300)  # listing içindeki seçenek (ebat); "" = tüm ürün
    qty: int = Field(1, ge=1, le=1_000_000)
    amount: float | None = Field(None, ge=0)
    item_id: int | None = None  # boyacıda: ürünün boya türü (fiyat listesi kalemi)


class PlanIn(BaseModel):
    mode: str = Field("price", max_length=20)
    targets: list[TargetIn] = Field(max_length=plan.MAX_TARGETS)
    remainder_party_id: int | None = None  # tahmini / boya dağıtımında işin dağıtılmayan kalanı bu dış pay sahibine yazılır


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=analyzer.MAX_PASTE_CHARS)
    create_job: bool = True
    job_id: int | None = None


def _write_limit(a: EntityAccess) -> None:
    ratelimit.hit("supply.write", f"user:{a.user.id}", 600, 3600)


# --------------------------------------------------------------- işler ----

@router.get("/{entity_id}/jobs")
def list_jobs(status: str = "", q: str = Query("", max_length=80), page: int = Query(0, ge=0), per_page: int = Query(30, ge=1, le=100),
              a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    if status and status != "open" and status not in JOB_STATUSES:  # "open": bekleyenler (onaylanmamış işler)
        raise HTTPException(422, "Geçersiz durum")
    return service.list_jobs(db, a, status, q, page, per_page)


@router.post("/{entity_id}/jobs")
def create_job(payload: JobIn, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    _write_limit(a)
    job = service.create_job(db, a, payload.title, payload.job_date, payload.note)
    return service.serialize_job(db, a, job, detail=True)


@router.get("/{entity_id}/jobs/{job_id}")
def get_job(job_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    job = service.get_job(db, a, job_id)
    service.refresh_prices(db, job)
    return service.serialize_job(db, a, job, detail=True)


@router.patch("/{entity_id}/jobs/{job_id}")
def patch_job(job_id: int, payload: JobPatch, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    _write_limit(a)
    job = service.get_job(db, a, job_id)
    fields = payload.model_dump(exclude_unset=True)  # gönderilen alan boş (null) olabilir: tutar ve süre bedeli silinebilir
    service.update_job(db, a, job, fields)
    return service.serialize_job(db, a, job, detail=True)


@router.put("/{entity_id}/jobs/{job_id}/lines")
def put_lines(job_id: int, payload: LinesIn, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    _write_limit(a)
    job = service.get_job(db, a, job_id)
    service.set_lines(db, a, job, [ln.model_dump() for ln in payload.lines])
    return service.serialize_job(db, a, job, detail=True)


@router.post("/{entity_id}/jobs/{job_id}/rebuild")
def rebuild(job_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    _write_limit(a)
    job = service.get_job(db, a, job_id)
    service.rebuild_from_document(db, a, job)
    return service.serialize_job(db, a, job, detail=True)


@router.post("/{entity_id}/jobs/{job_id}/submit")
def submit(job_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    job = service.get_job(db, a, job_id)
    service.submit(db, a, job)
    return service.serialize_job(db, a, job, detail=True)


@router.post("/{entity_id}/jobs/{job_id}/dispute")
def dispute(job_id: int, payload: DisputeIn, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    job = service.get_job(db, a, job_id)
    service.dispute(db, a, job, payload.note)
    return service.serialize_job(db, a, job, detail=True)


@router.post("/{entity_id}/jobs/{job_id}/confirm")
def confirm(job_id: int, allow_duplicate: bool = False, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    job = service.get_job(db, a, job_id)
    allocation.confirm(db, a, job, allow_duplicate)
    return service.serialize_job(db, a, job, detail=True)


@router.post("/{entity_id}/jobs/{job_id}/reopen")
def reopen(job_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    job = service.get_job(db, a, job_id)
    allocation.reopen(db, a, job)
    return service.serialize_job(db, a, job, detail=True)


@router.delete("/{entity_id}/jobs/{job_id}")
def delete_job(job_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    service.delete_job(db, a, service.get_job(db, a, job_id))
    return {"ok": True}


# --------------------------------------------------------------- dağıtım ----

@router.get("/{entity_id}/jobs/{job_id}/plan")
def get_plan(job_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    return allocation.preview(db, a, service.get_job(db, a, job_id))


@router.put("/{entity_id}/jobs/{job_id}/plan")
def put_plan(job_id: int, payload: PlanIn, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    _write_limit(a)
    job = service.get_job(db, a, job_id)
    return allocation.set_plan(db, a, job, payload.mode, [t.model_dump() for t in payload.targets], payload.remainder_party_id)


@router.get("/{entity_id}/jobs/{job_id}/suggestions")
def get_suggestions(job_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    return {"items": allocation.suggest_targets(db, a, service.get_job(db, a, job_id))}


@router.post("/{entity_id}/jobs/{job_id}/apply-costs")
def apply_job_costs(job_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    """Onaylanmış işin ürün paylarının hepsini Finans'a birim maliyet olarak yazar."""
    return allocation.apply_job_costs(db, a, service.get_job(db, a, job_id))


@router.post("/{entity_id}/jobs/{job_id}/undo-costs")
def undo_job_costs(job_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    """İşin Finans'a uygulanmış ürün maliyetlerini geri alır (uygulamadan önceki maliyete döner)."""
    return allocation.undo_job_costs(db, a, service.get_job(db, a, job_id))


@router.post("/{entity_id}/allocations/{allocation_id}/apply")
def apply_allocation(allocation_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    return allocation.apply_unit_cost(db, a, allocation_id)


@router.get("/{entity_id}/report")
def report(start: dt.date | None = None, end: dt.date | None = None, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    """Başlangıç ve bitiş verilmezse tüm zamanlar."""
    if (start is None) != (end is None) or (start and end and (end < start or (end - start).days > 3660)):
        raise HTTPException(422, "Geçersiz tarih")
    return reports.report(db, a, start, end)


# --------------------------------------------------------------- belge okuma ----

def _gate(db: Session, a: EntityAccess):
    """Yapay zekâya gidilecekse (önbellek/kural yetmediyse) kayıt sahibinin çalışma alanının AI izni ve kredisi kontrol
    edilir; tedarikçinin yüklediği belge de satıcının kredisinden düşer. Ölçüm bağlamı bu iş parçacığında kurulur."""
    def gate() -> None:
        ratelimit.hit("supply.ai", f"user:{a.user.id}", 20, 600)
        set_scope(check_ai_allowed(db, a.entity.workspace_id, a.user))
    return gate


def _require_upload(a: EntityAccess) -> None:
    if not (a.is_member or a.can("documents.upload")):
        raise HTTPException(403, "Bu işlem için yetkin yok")
    ratelimit.hit("supply.upload", f"entity:{a.entity.id}", 200, 3600)
    ratelimit.hit("supply.upload", f"user:{a.user.id}", 100, 3600)


def _duplicate(db: Session, a: EntityAccess, doc, create_job: bool) -> dict | None:
    """Aynı içerik bu kayıtta zaten okunmuşsa yeniden okunmaz: var olan belge ve (varsa) işi döner; iş yoksa istenirse açılır.
    Belge okunmamışsa (None) çağıran aynı belgeyi yeniden okutur."""
    data = documents.data_of(doc)
    if data is None:
        return None
    job = service.job_for_document(db, a, doc)
    if job is None and create_job and (a.is_member or a.can("jobs.create")):
        job = service.job_from_document(db, a, doc, doc_profile.normalize(data))
    return {"document": {**documents.serialize(doc), "data": data}, "job": service.serialize_job(db, a, job, detail=True) if job else None,
            "error": None, "duplicate": True}


def _read_note(db: Session, a: EntityAccess, data: dict | None, note: str) -> tuple[dict | None, str | None]:
    """Yükleme notunu belgeyle birlikte yorumlar: (birleşmiş veri, hata). Not yorumlanamazsa belge yine de işlenir; kullanıcı
    notu ayrı bir uyarıyla öğrenir (belge okuması başarısız sayılmaz)."""
    try:
        res = analyzer.analyze_text(db, a.entity.workspace_id, doc_profile.KEY, note, gate=_gate(db, a), min_chars=3)
    except analyzer.AnalyzerError as exc:
        return data, translate_detail(str(exc))
    except HTTPException as exc:
        return data, translate_detail(str(exc.detail))
    return doc_profile.merge_note(data, doc_profile.normalize(res.data), note), None


def _analyze(db: Session, a: EntityAccess, doc, content: bytes | None, text: str | None, create_job: bool, job_id: int | None, note: str = "") -> dict:
    """Belge önce kaydedilir (okuma başarısız olsa da dosya kaybolmaz), sonra okunur. `note`: yükleme penceresindeki not; belgeyle
    birlikte yorumlanır."""
    db.commit()
    error = note_error = None
    data, source = None, ""
    try:
        if text is not None:
            res = analyzer.analyze_text(db, a.entity.workspace_id, doc_profile.KEY, text, gate=_gate(db, a))
        else:
            res = analyzer.analyze_file(db, a.entity.workspace_id, doc_profile.KEY, content, doc.filename, doc.content_type, gate=_gate(db, a))
        data, source = doc_profile.normalize(res.data), res.source
    except analyzer.AnalyzerError as exc:
        error = translate_detail(str(exc))
    except HTTPException as exc:  # AI kapalı / kredi bitti / hız sınırı: dosya kayıtlı kalır, sonra tekrar okunabilir
        error = translate_detail(str(exc.detail))
    if note and error is None:
        data, note_error = _read_note(db, a, data, note)
    can_job = a.is_member or a.can("jobs.create")
    job = service.attach_analysis(db, a, doc, data, source, create_job and can_job and error is None, job_id if can_job else None)
    if error is None and data is not None:
        documents.discard_file(db, doc)  # okunan veri yeter; dosya saklanmaz
    return {
        "document": {**documents.serialize(doc), "data": data},
        "job": service.serialize_job(db, a, job, detail=True) if job else None,
        "error": error,
        "note_error": note_error,
    }


@router.post("/{entity_id}/documents")
def upload_document(
    file: UploadFile = File(...),
    create_job: bool = Form(True),
    job_id: int | None = Form(None),
    note: str = Form("", max_length=2000),
    a: EntityAccess = Depends(access_dep),
    db: Session = Depends(get_db),
):
    # Senkron uç nokta (iş parçacığında çalışır): depoya yazma, okuma ve AI çağrısı olay döngüsünü bekletmez.
    _require_upload(a)
    content = file.file.read(documents.MAX_BYTES + 1)
    if len(content) > documents.MAX_BYTES:
        raise HTTPException(413, f"Dosya çok büyük (en fazla {documents.MAX_BYTES // (1024 * 1024)} MB)")
    ctype = documents.validate(content, file.filename or "")
    doc = documents.existing(db, a, content)
    if doc is not None and job_id is None:
        dup = _duplicate(db, a, doc, create_job)
        if dup is not None:
            return dup
    doc = doc or documents.save(db, a, content, file.filename or "belge", ctype, doc_profile.KEY)
    return _analyze(db, a, doc, content, None, create_job, job_id, note.strip())


@router.post("/{entity_id}/documents/text")
def paste_text(payload: TextIn, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    _require_upload(a)
    text = payload.text.strip()
    if len(text) < 20:
        raise HTTPException(422, "Metin çok kısa.")
    body = text.encode("utf-8")
    doc = documents.existing(db, a, body)
    if doc is not None and payload.job_id is None:
        dup = _duplicate(db, a, doc, payload.create_job)
        if dup is not None:
            return dup
    doc = doc or documents.save(db, a, body, f"metin-{dt.datetime.utcnow():%Y%m%d-%H%M%S}.txt", "text/plain", doc_profile.KEY)
    return _analyze(db, a, doc, None, text, payload.create_job, payload.job_id)


@router.post("/{entity_id}/documents/{doc_id}/analyze")
def reanalyze(doc_id: int, create_job: bool = False, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    """Okunamamış (ya da yeniden okunması istenen) belgeyi depodaki dosyadan tekrar okur."""
    _require_upload(a)
    from app.core import blobstore

    doc = documents.get(db, a, doc_id)
    if not doc.path:
        raise HTTPException(409, "Dosya saklanmıyor; belgeyi yeniden yükle.")
    try:
        content = blobstore.read(doc.path)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Belge bulunamadı") from exc
    text = content.decode("utf-8", errors="ignore") if doc.content_type == "text/plain" else None
    return _analyze(db, a, doc, None if text is not None else content, text, create_job, None)


@router.post("/{entity_id}/documents/{doc_id}/job")
def job_from_document(doc_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    """Okunmuş bir belgeden yeni iş aç."""
    _write_limit(a)
    doc = documents.get(db, a, doc_id)
    data = documents.data_of(doc)
    if data is None:
        raise HTTPException(409, "Belge henüz okunmadı")
    existing = service.job_for_document(db, a, doc)
    job = existing or service.job_from_document(db, a, doc, doc_profile.normalize(data))
    return {**service.serialize_job(db, a, job, detail=True), "existing": existing is not None}


# ---- ambalaj: paket türleri, ürüne atama, Finans'a uygulama ----

class PackageLineIn(BaseModel):
    price_item_id: int
    constant: float = Field(0, ge=0, le=packages.MAX_COEFFICIENT)
    per_long: float = Field(0, ge=0, le=packages.MAX_COEFFICIENT)
    per_short: float = Field(0, ge=0, le=packages.MAX_COEFFICIENT)
    per_area: float = Field(0, ge=0, le=packages.MAX_COEFFICIENT)


class PackageIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    is_default: bool = False
    lines: list[PackageLineIn] = Field(max_length=packages.MAX_LINES)


class PackagePreviewIn(BaseModel):
    lines: list[PackageLineIn] = Field(max_length=packages.MAX_LINES)
    long_cm: float = Field(gt=0, le=10000)
    short_cm: float = Field(gt=0, le=10000)


class ProductPackageIn(BaseModel):
    shop_id: int
    listing_id: int
    variant: str = Field("", max_length=300)
    package_ids: list[int] = Field(default_factory=list, max_length=20)
    none: bool = False  # "ambalajsız": varsayılan paket türleri de uygulanmaz


@router.get("/{entity_id}/packages")
def list_packages(a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    return {"items": packages.list_types(db, a)}


@router.post("/{entity_id}/packages")
def create_package(payload: PackageIn, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    return packages.save_type(db, a, None, payload.name, payload.is_default, [ln.model_dump() for ln in payload.lines])


@router.put("/{entity_id}/packages/{package_id}")
def update_package(package_id: int, payload: PackageIn, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    return packages.save_type(db, a, package_id, payload.name, payload.is_default, [ln.model_dump() for ln in payload.lines])


@router.delete("/{entity_id}/packages/{package_id}")
def delete_package(package_id: int, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    packages.delete_type(db, a, package_id)
    return {"ok": True}


@router.post("/{entity_id}/packages/preview")
def preview_package(payload: PackagePreviewIn, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    """Kaydedilmemiş tarifin örnek ebat için miktar ve maliyeti."""
    return packages.preview(db, a, [ln.model_dump() for ln in payload.lines], payload.long_cm, payload.short_cm)


@router.post("/{entity_id}/packages/apply")
def apply_package_costs(dry_run: bool = Query(True), a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    """Bu kaydın paket türlerinin ürün başına maliyetini Finans'a ambalaj bileşeni olarak yazar; `dry_run` yalnızca önizler."""
    return packages.apply_costs(db, a, dry_run)


@router.get("/{entity_id}/product-packages")
def list_product_packages(a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    return {"items": packages.list_assignments(db, a)}


@router.put("/{entity_id}/product-packages")
def put_product_packages(payload: ProductPackageIn, a: EntityAccess = Depends(access_dep), db: Session = Depends(get_db)):
    packages.assign(db, a, payload.shop_id, payload.listing_id, payload.variant, payload.package_ids, payload.none)
    return {"ok": True}

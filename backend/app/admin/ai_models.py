"""Yönetim > Modeller: model kataloğu, görev atamaları ve sağlayıcı anahtarları. Her yazmadan sonra katalog önbelleği
boşaltılır (bu süreç hemen, diğer süreçler en geç catalog.CACHE_SECONDS içinde yeni değeri görür)."""
import datetime as dt
import json

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.schemas import AiModelIn, AiModelOut, CatalogOut, ProviderKeyOut, TaskOut, TestOut
from app.ai import catalog
from app.ai.models import AiModel, AiProviderKey, AiTaskModel
from app.core.i18n import tr

IMAGE_SIZES = ("1K", "2K", "4K")
MASK_DOTS = 16


def mask(value: str) -> str:
    """Sabit genişlikte maske: anahtarın yalnızca son 4 karakteri görünür."""
    if not value:
        return ""
    return "•" * len(value) if len(value) <= 4 else "•" * MASK_DOTS + value[-4:]


def _options(row: AiModel) -> dict:
    try:
        value = json.loads(row.options_json or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _out(row: AiModel) -> AiModelOut:
    return AiModelOut(
        id=row.id, kind=row.kind, provider=row.provider, model_id=row.model_id, label=row.label, active=row.active,
        supported=row.provider in catalog.SUPPORTED_PROVIDERS.get(row.kind, ()),
        input_usd_per_mtok=row.input_usd_per_mtok, output_usd_per_mtok=row.output_usd_per_mtok, unit_usd=row.unit_usd, options=_options(row),
    )


def get_catalog(db: Session) -> CatalogOut:
    try:
        rows = db.scalars(select(AiModel).order_by(AiModel.kind, AiModel.provider, AiModel.label)).all()
        if not rows:  # ilk açılışta katalog .env değerleriyle dolsun
            catalog.invalidate()
            catalog.resolve("assistant")
            rows = db.scalars(select(AiModel).order_by(AiModel.kind, AiModel.provider, AiModel.label)).all()
        assigned = {t.task: t.model_id for t in db.scalars(select(AiTaskModel)).all()}
        from_db = True
    except SQLAlchemyError:
        db.rollback()
        rows, assigned, from_db = [], {}, False
    tasks = []
    for task, (kind, name_tr, name_en) in catalog.TASKS.items():
        m = catalog.resolve(task)
        tasks.append(TaskOut(task=task, kind=kind, name_tr=name_tr, name_en=name_en, model_id=assigned.get(task), effective=f"{m.provider}/{m.model_id}"))
    keys = [ProviderKeyOut(provider=p, masked=mask(catalog.api_key(p)), source=catalog.key_source(p)) for p in catalog.PROVIDERS]
    return CatalogOut(
        models=[_out(r) for r in rows], tasks=tasks, keys=keys,
        providers={k: list(v) for k, v in catalog.SUPPORTED_PROVIDERS.items()}, from_db=from_db,
    )


def _validate(data: AiModelIn) -> dict:
    if data.provider not in catalog.PROVIDERS:
        raise AdminError(422, f"Bilinmeyen sağlayıcı: {data.provider}")
    options = {}
    if data.kind == "image":
        size = str(data.options.get("image_size") or "2K")
        if size not in IMAGE_SIZES:
            raise AdminError(422, "Görsel boyutu 1K, 2K ya da 4K olmalı.")
        options["image_size"] = size
    return options


def _assigned_tasks(db: Session, model_id: int) -> list[str]:
    return list(db.scalars(select(AiTaskModel.task).where(AiTaskModel.model_id == model_id)))


def create_model(db: Session, data: AiModelIn) -> AiModelOut:
    options = _validate(data)
    now = dt.datetime.utcnow()
    row = AiModel(
        kind=data.kind, provider=data.provider, model_id=data.model_id.strip(), label=data.label.strip(), active=data.active,
        input_usd_per_mtok=data.input_usd_per_mtok, output_usd_per_mtok=data.output_usd_per_mtok, unit_usd=data.unit_usd,
        options_json=json.dumps(options), created_at=now, updated_at=now,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AdminError(409, "Bu sağlayıcıda aynı model zaten katalogda.") from exc
    catalog.invalidate()
    return _out(row)


def update_model(db: Session, model_id: int, data: AiModelIn) -> AiModelOut:
    row = db.get(AiModel, model_id)
    if row is None:
        raise AdminError(404, "Model bulunamadı")
    options = _validate(data)
    tasks = _assigned_tasks(db, model_id)
    if tasks and (not data.active or data.kind != row.kind or data.provider not in catalog.SUPPORTED_PROVIDERS.get(data.kind, ())):
        raise AdminError(409, "Bu model bir göreve atanmış; önce görevi başka bir modele ata.")
    row.kind, row.provider, row.model_id, row.label, row.active = data.kind, data.provider, data.model_id.strip(), data.label.strip(), data.active
    row.input_usd_per_mtok, row.output_usd_per_mtok, row.unit_usd = data.input_usd_per_mtok, data.output_usd_per_mtok, data.unit_usd
    row.options_json = json.dumps(options)
    row.updated_at = dt.datetime.utcnow()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AdminError(409, "Bu sağlayıcıda aynı model zaten katalogda.") from exc
    catalog.invalidate()
    return _out(row)


def delete_model(db: Session, model_id: int) -> AiModel:
    row = db.get(AiModel, model_id)
    if row is None:
        raise AdminError(404, "Model bulunamadı")
    if _assigned_tasks(db, model_id):
        raise AdminError(409, "Bu model bir göreve atanmış; önce görevi başka bir modele ata.")
    db.delete(row)
    db.commit()
    catalog.invalidate()
    return row


def assign_task(db: Session, task: str, model_id: int) -> None:
    if task not in catalog.TASKS:
        raise AdminError(404, "Görev bulunamadı")
    row = db.get(AiModel, model_id)
    kind = catalog.TASKS[task][0]
    if row is None or not row.active or row.kind != kind or row.provider not in catalog.SUPPORTED_PROVIDERS.get(kind, ()):
        raise AdminError(422, "Bu görev için uygun (aktif, aynı türde ve desteklenen) bir model seç.")
    current = db.get(AiTaskModel, task)
    if current is None:
        db.add(AiTaskModel(task=task, model_id=model_id))
    else:
        current.model_id = model_id
    db.commit()
    catalog.invalidate()


def set_key(db: Session, provider: str, api_key: str) -> None:
    if provider not in catalog.PROVIDERS:
        raise AdminError(404, f"Bilinmeyen sağlayıcı: {provider}")
    row = db.get(AiProviderKey, provider)
    if row is None:
        db.add(AiProviderKey(provider=provider, api_key=api_key.strip(), updated_at=dt.datetime.utcnow()))
    else:
        row.api_key = api_key.strip()
        row.updated_at = dt.datetime.utcnow()
    db.commit()
    catalog.invalidate()


def clear_key(db: Session, provider: str) -> None:
    """Panelden girilen anahtarı siler; .env'de anahtar varsa o kullanılmaya devam eder."""
    row = db.get(AiProviderKey, provider)
    if row is not None:
        db.delete(row)
        db.commit()
    catalog.invalidate()


def test_key(provider: str, api_key: str | None = None) -> TestOut:
    """Anahtarı sağlayıcının ucuz bir uç noktasıyla (model listesi) dener; `api_key` verilmezse kayıtlı anahtar."""
    from app.ai.client import get_anthropic_client, get_google_client, get_openai_client

    key = (api_key or "").strip() or catalog.api_key(provider)
    if not key:
        return TestOut(ok=False, message=tr("Anahtar tanımlı değil", "No key is set"))
    try:
        if provider == "openai":
            get_openai_client(key).models.list()
        elif provider == "anthropic":
            get_anthropic_client(key).models.list(limit=1)
        elif provider == "google":
            get_google_client(key).models.list(config={"page_size": 1})
        else:
            return TestOut(ok=False, message=tr(f"Bilinmeyen sağlayıcı: {provider}", f"Unknown provider: {provider}"))
    except Exception as exc:  # noqa: BLE001 — sağlayıcının hata metni olduğu gibi gösterilir
        return TestOut(ok=False, message=str(exc)[:300])
    return TestOut(ok=True, message=tr("Bağlantı başarılı", "Connection works"))


def test_etsy() -> TestOut:
    """Etsy anahtarı .env'dedir (uygulama kimliği; panelden değişmez). Herkese açık taksonomi uç noktasıyla denenir."""
    from app.taxonomy import service as taxonomy_service

    try:
        taxonomy_service.get_seller_taxonomy_nodes()
    except Exception as exc:  # noqa: BLE001
        return TestOut(ok=False, message=str(exc)[:300])
    return TestOut(ok=True, message=tr("Etsy bağlantısı başarılı", "Etsy connection works"))

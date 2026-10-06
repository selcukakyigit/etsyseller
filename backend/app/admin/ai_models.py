"""Yönetim > Modeller: model kataloğu, fiyatlanan seçenekler (görsel/video), görev atamaları ve sağlayıcı anahtarları.
Her yazmadan sonra katalog önbelleği boşaltılır (bu süreç hemen, diğer süreçler en geç catalog.CACHE_SECONDS içinde
yeni değeri görür)."""
import datetime as dt
import json

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.admin.deps import AdminError
from app.admin.schemas import AiModelIn, AiModelOut, AiVariantIn, AiVariantOut, CatalogOut, PricingOut, ProviderKeyOut, TaskOut, TestOut
from app.ai import catalog
from app.ai.models import AiModel, AiModelVariant, AiProviderKey, AiTaskModel
from app.billing import pricing, settings as credit_settings
from app.core.i18n import tr

IMAGE_SIZES = ("1K", "2K", "4K")
MAX_DURATION = 60
MASK_DOTS = 16


def mask(value: str) -> str:
    """Sabit genişlikte maske: anahtarın yalnızca son 4 karakteri görünür."""
    if not value:
        return ""
    return "•" * len(value) if len(value) <= 4 else "•" * MASK_DOTS + value[-4:]


def _json(text: str | None) -> dict:
    try:
        value = json.loads(text or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _variant_out(row: AiModelVariant) -> AiVariantOut:
    v = catalog.Variant(row.key, row.label_tr, row.label_en, row.cost_usd, row.credits)
    return AiVariantOut(
        key=row.key, label_tr=row.label_tr, label_en=row.label_en, cost_usd=row.cost_usd, credits=row.credits,
        params=_json(row.params_json), is_default=row.is_default, active=row.active,
        unit_credits=pricing.unit_credits(v), auto_credits=pricing.to_credits(row.cost_usd),
    )


def _out(row: AiModel, variants: list[AiModelVariant]) -> AiModelOut:
    return AiModelOut(
        id=row.id, kind=row.kind, provider=row.provider, model_id=row.model_id, label=row.label, active=row.active,
        supported=row.provider in catalog.SUPPORTED_PROVIDERS.get(row.kind, ()),
        input_usd_per_mtok=row.input_usd_per_mtok, output_usd_per_mtok=row.output_usd_per_mtok, options=_json(row.options_json),
        variants=[_variant_out(v) for v in variants],
    )


def _variants_by_model(db: Session, model_ids: list[int] | None = None) -> dict[int, list[AiModelVariant]]:
    stmt = select(AiModelVariant).order_by(AiModelVariant.sort, AiModelVariant.id)
    if model_ids is not None:
        stmt = stmt.where(AiModelVariant.model_id.in_(model_ids))
    out: dict[int, list[AiModelVariant]] = {}
    for v in db.scalars(stmt).all():
        out.setdefault(v.model_id, []).append(v)
    return out


def _pricing() -> PricingOut:
    return PricingOut(credit_usd=credit_settings.setting("credit_usd"), credit_markup=credit_settings.setting("credit_markup"), units=catalog.UNITS)


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
    try:
        variants = _variants_by_model(db) if rows else {}
    except SQLAlchemyError:  # 0028 uygulanmamış: modeller seçeneksiz listelenir
        db.rollback()
        variants = {}
    tasks = []
    for task, (kind, name_tr, name_en) in catalog.TASKS.items():
        m = catalog.resolve(task)
        tasks.append(TaskOut(task=task, kind=kind, name_tr=name_tr, name_en=name_en, model_id=assigned.get(task), effective=f"{m.provider}/{m.model_id}"))
    keys = [ProviderKeyOut(provider=p, masked=mask(catalog.api_key(p)), source=catalog.key_source(p)) for p in catalog.PROVIDERS]
    return CatalogOut(
        models=[_out(r, variants.get(r.id, [])) for r in rows], tasks=tasks, keys=keys,
        providers={k: list(v) for k, v in catalog.SUPPORTED_PROVIDERS.items()}, pricing=_pricing(), from_db=from_db,
    )


# ---- Doğrulama


def _options(data: AiModelIn) -> dict:
    """Modelin özellikleri, türüne göre. Video: seçilebilir süreler (sn) ve varsayılan süre."""
    if data.kind != "video":
        return {}
    raw = data.options.get("durations") or []
    try:
        durations = sorted({int(d) for d in raw})
    except (TypeError, ValueError) as exc:
        raise AdminError(422, "Süreler tam sayı (saniye) olmalı.") from exc
    if not durations or durations[0] < 1 or durations[-1] > MAX_DURATION:
        raise AdminError(422, "En az bir süre gir; süreler 1–60 sn arasında olmalı.")
    default = data.options.get("default_duration")
    return {"durations": durations, "default_duration": int(default) if default in durations else durations[0]}


def _params(provider: str, kind: str, params: dict) -> dict:
    """Sağlayıcıya gidecek parametreler: düz değerler (metin, sayı, evet/hayır). Google görselinde çözünürlük şart."""
    for k, v in params.items():
        if not isinstance(k, str) or not k or len(k) > 40 or not isinstance(v, (str, int, float, bool)):
            raise AdminError(422, "Seçenek parametreleri düz değerler olmalı (metin, sayı, evet/hayır).")
    if provider == "google" and kind == "image" and params.get("image_size") not in IMAGE_SIZES:
        raise AdminError(422, "Google görsel seçeneğinde çözünürlük (image_size) 1K, 2K ya da 4K olmalı.")
    return params


def _variants(data: AiModelIn) -> list[AiVariantIn]:
    """Metin modelinde seçenek olmaz. Görsel/video modelinde en az bir aktif seçenek, anahtarlar benzersiz ve tam bir
    varsayılan (aktif) seçenek olur; varsayılan işaretlenmemişse ilk aktif seçenek varsayılan sayılır."""
    if data.kind == "llm":
        return []
    variants = [v.model_copy(update={"params": _params(data.provider, data.kind, v.params)}) for v in data.variants]
    keys = [v.key for v in variants]
    if len(set(keys)) != len(keys):
        raise AdminError(422, "Seçenek anahtarları benzersiz olmalı.")
    active = [v for v in variants if v.active]
    if not active:
        raise AdminError(422, "Görsel ve video modellerinde en az bir aktif fiyat seçeneği olmalı.")
    defaults = [v for v in variants if v.is_default]
    if len(defaults) > 1:
        raise AdminError(422, "Yalnızca bir seçenek varsayılan olabilir.")
    if defaults and not defaults[0].active:
        raise AdminError(422, "Varsayılan seçenek aktif olmalı.")
    if not defaults:
        first = active[0].key
        variants = [v.model_copy(update={"is_default": v.key == first}) for v in variants]
    return variants


def _check(data: AiModelIn) -> tuple[dict, list[AiVariantIn]]:
    if data.provider not in catalog.PROVIDERS:
        raise AdminError(422, f"Bilinmeyen sağlayıcı: {data.provider}")
    return _options(data), _variants(data)


# ---- Yazma


def _assigned_tasks(db: Session, model_id: int) -> list[str]:
    return list(db.scalars(select(AiTaskModel.task).where(AiTaskModel.model_id == model_id)))


def _apply(db: Session, row: AiModel, data: AiModelIn, options: dict, variants: list[AiVariantIn]) -> None:
    """Model alanlarını yazar ve seçenekleri gönderilen listeyle değiştirir (seçenek kimliği hiçbir yerde tutulmuyor;
    defter seçeneği anahtarıyla kaydeder)."""
    row.kind, row.provider, row.model_id, row.label, row.active = data.kind, data.provider, data.model_id.strip(), data.label.strip(), data.active
    is_llm = data.kind == "llm"
    row.input_usd_per_mtok = data.input_usd_per_mtok if is_llm else None
    row.output_usd_per_mtok = data.output_usd_per_mtok if is_llm else None
    row.options_json = json.dumps(options)
    row.updated_at = dt.datetime.utcnow()
    db.flush()
    db.execute(delete(AiModelVariant).where(AiModelVariant.model_id == row.id))
    for i, v in enumerate(variants):
        db.add(AiModelVariant(
            model_id=row.id, key=v.key, label_tr=v.label_tr.strip(), label_en=v.label_en.strip(), cost_usd=v.cost_usd, credits=v.credits,
            params_json=json.dumps(v.params), is_default=v.is_default, active=v.active, sort=i,
        ))


def _commit(db: Session, row: AiModel) -> AiModelOut:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AdminError(409, "Bu sağlayıcıda aynı model zaten katalogda.") from exc
    catalog.invalidate()
    return _out(row, _variants_by_model(db, [row.id]).get(row.id, []))


def create_model(db: Session, data: AiModelIn) -> AiModelOut:
    options, variants = _check(data)
    row = AiModel(created_at=dt.datetime.utcnow())
    db.add(row)
    _apply(db, row, data, options, variants)
    return _commit(db, row)


def update_model(db: Session, model_id: int, data: AiModelIn) -> AiModelOut:
    row = db.get(AiModel, model_id)
    if row is None:
        raise AdminError(404, "Model bulunamadı")
    options, variants = _check(data)
    tasks = _assigned_tasks(db, model_id)
    if tasks and (not data.active or data.kind != row.kind or data.provider not in catalog.SUPPORTED_PROVIDERS.get(data.kind, ())):
        raise AdminError(409, "Bu model bir göreve atanmış; önce görevi başka bir modele ata.")
    _apply(db, row, data, options, variants)
    return _commit(db, row)


def delete_model(db: Session, model_id: int) -> AiModel:
    row = db.get(AiModel, model_id)
    if row is None:
        raise AdminError(404, "Model bulunamadı")
    if _assigned_tasks(db, model_id):
        raise AdminError(409, "Bu model bir göreve atanmış; önce görevi başka bir modele ata.")
    db.execute(delete(AiModelVariant).where(AiModelVariant.model_id == model_id))
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


# ---- Anahtarlar


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
    """Anahtarı sağlayıcının ucuz bir uç noktasıyla (model listesi / hesap) dener; `api_key` verilmezse kayıtlı anahtar."""
    from app.ai.client import get_anthropic_client, get_google_client, get_openai_client, replicate_account

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
        elif provider == "replicate":
            replicate_account(key)
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

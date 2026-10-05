"""Yapay zekâ model kataloğu: her görevin (asistan, SEO önerisi, görsel üretimi…) hangi modeli ve hangi anahtarı
kullanacağının TEK kaynağı. Modeller, görev atamaları ve şifreli anahtarlar veritabanındadır (bkz. ai/models.py) ve
Yönetim > Modeller'den değişir.

Okuma süreç içinde CACHE_SECONDS önbelleklenir; panelden değişiklikte bu süreç hemen (`invalidate`), diğer süreçler
(ör. ayrı bir worker) en geç CACHE_SECONDS içinde yeni değeri görür.

Dayanıklılık: tablolar yoksa (göç uygulanmamış) ya da okunamazsa .env değerlerine düşülür, yani bu modül yüzünden AI
çağrısı hiçbir zaman çökmez. Tablolar var ama katalog boşsa .env değerleriyle bir kez doldurulur; böylece ilk yayında
davranış aynen sürer."""
import datetime as dt
import json
import logging
import threading
import time
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.ai.models import AiModel, AiProviderKey, AiTaskModel
from app.core.config import settings
from app.core.db import SessionLocal

log = logging.getLogger(__name__)
CACHE_SECONDS = 30

KINDS = ("llm", "image", "video")

# Kodda istemcisi (adaptörü) olan sağlayıcılar. Yeni bir sağlayıcı önce burada ve ai/client.py'de desteklenmeli;
# katalog, desteklenmeyen sağlayıcıya görev atanmasına izin vermez. Video henüz hiçbir göreve bağlı değil.
SUPPORTED_PROVIDERS: dict[str, tuple[str, ...]] = {"llm": ("anthropic", "openai"), "image": ("google",), "video": ()}
PROVIDERS = ("anthropic", "openai", "google")

# Görev -> (model türü, Türkçe ad, İngilizce ad)
TASKS: dict[str, tuple[str, str, str]] = {
    "assistant": ("llm", "Asistan sohbeti", "Assistant chat"),
    "seo": ("llm", "SEO önerisi", "SEO suggestion"),
    "vision": ("llm", "Fotoğraf alt metni", "Photo alt text"),
    "document": ("llm", "Fatura ve tablo okuma", "Invoice and table reading"),
    "image": ("image", "Görsel üretimi", "Image generation"),
}


@dataclass(frozen=True)
class ResolvedModel:
    """Bir AI çağrısının ihtiyaç duyduğu her şey. `id` None ise model katalogda değil, .env'den geliyor."""

    id: int | None
    kind: str
    provider: str
    model_id: str
    label: str
    input_usd_per_mtok: float | None = None
    output_usd_per_mtok: float | None = None
    unit_usd: float | None = None
    options: dict = field(default_factory=dict)


@dataclass
class _Snapshot:
    models: list[ResolvedModel]
    tasks: dict[str, int]
    keys: dict[str, str]
    from_db: bool


_lock = threading.Lock()
_cache: tuple[float, _Snapshot] | None = None


def _env_models() -> list[ResolvedModel]:
    return [
        ResolvedModel(None, "llm", "anthropic", settings.anthropic_model, settings.anthropic_model),
        ResolvedModel(None, "llm", "openai", settings.openai_model, settings.openai_model),
        ResolvedModel(None, "image", "google", settings.google_image_model, settings.google_image_model, options={"image_size": settings.google_image_size}),
    ]


def _env_snapshot() -> _Snapshot:
    return _Snapshot(models=_env_models(), tasks={}, keys={}, from_db=False)


def _resolved(row: AiModel) -> ResolvedModel:
    try:
        options = json.loads(row.options_json or "{}")
    except json.JSONDecodeError:
        options = {}
    return ResolvedModel(
        row.id, row.kind, row.provider, row.model_id, row.label, row.input_usd_per_mtok, row.output_usd_per_mtok, row.unit_usd,
        options if isinstance(options, dict) else {},
    )


def _seed(db) -> None:
    """Boş katalogu .env'deki modellerle doldurur; metin görevleri .env'deki AI_PROVIDER'ın modeline atanır."""
    now = dt.datetime.utcnow()
    rows: dict[str, AiModel] = {}
    for m in _env_models():
        row = AiModel(kind=m.kind, provider=m.provider, model_id=m.model_id, label=m.label, options_json=json.dumps(m.options), created_at=now, updated_at=now)
        db.add(row)
        rows[m.provider] = row
    db.flush()
    default_llm = rows.get(settings.ai_provider) or rows["openai"]
    for task, (kind, _, _) in TASKS.items():
        db.add(AiTaskModel(task=task, model_id=(rows["google"] if kind == "image" else default_llm).id))
    db.commit()
    log.info("AI model kataloğu .env değerleriyle dolduruldu")


def _load_from_db() -> _Snapshot:
    db = SessionLocal()
    try:
        rows = db.scalars(select(AiModel).order_by(AiModel.kind, AiModel.provider, AiModel.id)).all()
        if not rows:
            try:
                _seed(db)
            except IntegrityError:  # başka bir süreç aynı anda doldurdu
                db.rollback()
            rows = db.scalars(select(AiModel).order_by(AiModel.kind, AiModel.provider, AiModel.id)).all()
        tasks = {t.task: t.model_id for t in db.scalars(select(AiTaskModel)).all()}
        keys: dict[str, str] = {}
        for k in db.scalars(select(AiProviderKey)).all():
            try:
                keys[k.provider] = k.api_key
            except RuntimeError:  # şifre çözülemedi (TOKEN_ENCRYPTION_KEY değişmiş): .env anahtarına düşülür
                log.error("AI anahtarı çözülemedi: %s", k.provider)
        # Pasif modeller hiçbir göreve verilmez; panel listesi tabloyu doğrudan okur, bu anlık görüntüyü değil.
        return _Snapshot(models=[_resolved(r) for r in rows if r.active], tasks=tasks, keys=keys, from_db=True)
    finally:
        db.close()


def _snapshot() -> _Snapshot:
    global _cache
    now = time.monotonic()
    with _lock:
        if _cache and now - _cache[0] < CACHE_SECONDS:
            return _cache[1]
    try:
        snap = _load_from_db()
    except (SQLAlchemyError, RuntimeError):
        log.warning("AI kataloğu okunamadı; .env ayarları kullanılıyor", exc_info=True)
        snap = _env_snapshot()
    with _lock:
        _cache = (now, snap)
    return snap


def invalidate() -> None:
    global _cache
    with _lock:
        _cache = None


def is_usable(m: ResolvedModel, kind: str) -> bool:
    return m.kind == kind and m.provider in SUPPORTED_PROVIDERS.get(kind, ())


def resolve(task: str) -> ResolvedModel:
    """Görevin modeli: atanmış ve hâlâ aktif/desteklenen model; yoksa aynı türdeki ilk aktif model (metinde AI_PROVIDER
    tercih edilir); o da yoksa .env'deki model."""
    kind = TASKS[task][0]
    snap = _snapshot()
    assigned = snap.tasks.get(task)
    candidates = [m for m in snap.models if is_usable(m, kind)]
    for m in candidates:
        if m.id is not None and m.id == assigned:
            return m
    candidates.sort(key=lambda m: m.provider != settings.ai_provider)
    if candidates:
        return candidates[0]
    return next(m for m in _env_models() if m.kind == kind)


def by_id(model_db_id: int, kind: str) -> ResolvedModel | None:
    return next((m for m in _snapshot().models if m.id == model_db_id and is_usable(m, kind)), None)


def choices(kind: str) -> list[ResolvedModel]:
    """Kullanıcıya seçenek olarak sunulabilecek modeller (ör. asistandaki model seçici)."""
    return [m for m in _snapshot().models if is_usable(m, kind)]


def api_key(provider: str) -> str:
    """Önce panelden girilen (veritabanındaki) anahtar, yoksa .env."""
    key = _snapshot().keys.get(provider)
    if key:
        return key
    return {"openai": settings.openai_api_key, "anthropic": settings.anthropic_api_key, "google": settings.google_api_key}.get(provider, "")


def key_source(provider: str) -> str:
    """"db" | "env" | "" — panelde anahtarın nereden geldiğini göstermek için."""
    if _snapshot().keys.get(provider):
        return "db"
    return "env" if api_key(provider) else ""


def ready(model: ResolvedModel) -> bool:
    return bool(model.provider and api_key(model.provider))


class NotConfigured(Exception):
    """Görev için anahtarı tanımlı hiçbir model yok."""


def not_configured_message() -> str:
    from app.core.i18n import tr

    return tr(
        "Yapay zekâ şu an kullanılamıyor (sağlayıcı anahtarı tanımlı değil). Lütfen daha sonra tekrar dene.",
        "AI is unavailable right now (no provider key is set). Please try again later.",
    )


def resolve_ready(task: str) -> ResolvedModel:
    """`resolve` gibi, ama atanan modelin sağlayıcı anahtarı yoksa aynı türde anahtarı olan başka bir modele düşer.
    Hiçbiri yoksa NotConfigured."""
    model = resolve(task)
    if ready(model):
        return model
    fallback = next((m for m in choices(TASKS[task][0]) if ready(m)), None)
    if fallback is None:
        raise NotConfigured(not_configured_message())
    return fallback

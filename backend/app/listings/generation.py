"""Listing için yapay zekâ ile sıfırdan görsel ve video üretimi ("Oluştur" penceresi). Sonuç taslak dosyası olarak
kaydedilir (bkz. drafts.py); Etsy'ye "Yayınla" ile gider.

Kullanıcı modeli ve seçeneği (çözünürlük, taslak…) pencerede seçer; seçim geçersizse görevin modeline düşülür (bkz.
catalog.resolve_choice).

Video üretimi onlarca saniye sürer: `start_video` işi başlatır ve istemciye mühürlü bir bilet verir (sağlayıcının iş
kimliği, mağaza, listing ve başlarken gösterilen fiyat; bkz. core/crypto.seal), istemci `poll_video` ile bileti sorar.
İş bitince video bir kez kaydedilir ve başlarken gösterilen fiyat düşülür; aynı bilet tekrar sorulursa kayıtlı dosya
döner. Böylece sunucuda iş tablosu tutulmaz."""
import threading
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import catalog, video_gen
from app.billing import credits, metering, pricing
from app.core import blobstore, crypto
from app.core.i18n import tr
from app.listings.drafts import _source_image_bytes, get_file, save_file
from app.listings.models import DraftFile
from app.shops.models import Shop

# Etsy ilan videosu 5–15 saniye olmalı; katalogdaki süreler bu aralığa göre süzülür.
ETSY_VIDEO_SECONDS = (5, 15)
# Bir listing'e en fazla bu kadar video eklenebilir (düzenleyicideki MAX_VIDEOS ile aynı).
MAX_LISTING_VIDEOS = 2
# Hareket tarifi verilmezse: ürünü değiştirmeden, sakin bir ürün videosu (düzenleyicideki varsayılanla aynı).
DEFAULT_VIDEO_PROMPT = "A smooth, slow cinematic camera move around the product, soft natural light, the product itself stays exactly the same."
VIDEO_JOB_SECONDS = 3600  # bilet bu süreden sonra geçersiz (sağlayıcı da çıktıyı bir saat tutuyor)

_video_locks: dict[str, threading.Lock] = {}
_video_locks_guard = threading.Lock()


class InsufficientCredits(Exception):
    def __init__(self, needed: int):
        super().__init__(needed)
        self.needed = needed


@dataclass(frozen=True)
class Reference:
    """Ürün referansı: yeni yüklenen bir dosya ya da listing'in kendi fotoğraflarından biri (henüz Etsy'ye yüklenmemiş
    taslak fotoğrafsa dosyası `image_draft_file_id`)."""

    draft_file_id: str | None = None
    image_id: int | None = None
    image_draft_file_id: str | None = None


def _reference_bytes(db: Session, shop: Shop, listing_id: int, ref: Reference) -> tuple[bytes, str] | None:
    if ref.image_id is not None:
        return _source_image_bytes(db, shop, listing_id, ref.image_id, ref.image_draft_file_id)
    if ref.draft_file_id:
        f = get_file(db, shop, listing_id, ref.draft_file_id)
        if f is not None:
            return blobstore.read(f.path), f.content_type
    return None


# ---------------------------------------------------------------- görsel


def generate_image(
    db: Session, shop: Shop, listing_id: int, prompt: str, ref: Reference, model_db_id: int | None = None, variant_key: str | None = None,
) -> dict:
    from app.ai import image_gen

    new_bytes, mime = image_gen.generate_from_text(prompt, _reference_bytes(db, shop, listing_id, ref), model_db_id, variant_key)
    return save_file(db, shop, listing_id, "image", f"ai-generated{image_gen.guess_extension(mime)}", mime, new_bytes)


# ---------------------------------------------------------------- video


def video_durations(model: catalog.ResolvedModel) -> list[int]:
    lo, hi = ETSY_VIDEO_SECONDS
    return [d for d in video_gen.durations(model) if lo <= d <= hi]


def quote_video(duration: int, model_db_id: int | None = None, variant_key: str | None = None):
    """(model, varyant, fiyat): süre desteklenmiyorsa ValueError. Başlatma ve kullanıcıya önceden fiyat söyleme aynı hesabı kullanır."""
    model, variant = video_gen.choose(model_db_id, variant_key)
    allowed = video_durations(model)
    if duration not in allowed:
        raise ValueError(tr(f"Bu model bu süreyi desteklemiyor; seçenekler: {', '.join(str(d) for d in allowed)} sn.", f"This model does not support this duration; options: {', '.join(str(d) for d in allowed)} s."))
    return model, variant, pricing.for_units(variant, duration)


def start_video(
    db: Session, shop: Shop, listing_id: int, prompt: str, duration: int, ref: Reference,
    model_db_id: int | None = None, variant_key: str | None = None, image: tuple[bytes, str] | None = None,
) -> dict:
    """`image` verilirse başlangıç resmi odur (ör. sohbetteki bir resim); yoksa `ref`'teki listing fotoğrafı/dosyası."""
    model, variant, price = quote_video(duration, model_db_id, variant_key)
    if not credits.can_afford(shop.workspace_id, price.credits):
        raise InsufficientCredits(price.credits)
    prediction_id = video_gen.start(model, variant, prompt, duration, image if image is not None else _reference_bytes(db, shop, listing_id, ref))
    job = crypto.seal({
        "p": prediction_id, "s": shop.id, "l": listing_id, "m": model.id, "pr": model.provider, "mi": model.model_id,
        "v": variant.key if variant else None, "d": duration, "c": price.credits, "u": price.cost_usd,
    })
    return {"job": job, "credits": price.credits}


def _job_lock(prediction_id: str) -> threading.Lock:
    with _video_locks_guard:
        return _video_locks.setdefault(prediction_id, threading.Lock())


def _saved_video(db: Session, shop: Shop, filename: str) -> DraftFile | None:
    """Bu işin (dosya adında sağlayıcı iş kimliği var) kayıtlı videosu. Listing'e bakılmaz: yeni taslak yayınlanınca listing
    kimliği değişir ve aynı bilet yeniden sorulursa video ikinci kez kaydedilip kredisi iki kez düşülmesin."""
    return db.scalar(select(DraftFile).where(DraftFile.shop_id == shop.id, DraftFile.kind == "video", DraftFile.filename == filename))


def poll_video(db: Session, shop: Shop, listing_id: int, token: str) -> dict:
    """{"status": "running"} ya da {"status": "done", "file_id": …}. Üretim başarısızsa VideoGenError."""
    job = crypto.unseal(token, VIDEO_JOB_SECONDS)
    if not job or job.get("s") != shop.id or job.get("l") != listing_id:
        raise LookupError(tr("Video işi bulunamadı ya da süresi doldu.", "The video job was not found or has expired."))
    filename = f"ai-video-{job['p']}.mp4"
    saved = _saved_video(db, shop, filename)
    if saved is not None:
        return {"status": "done", "file_id": saved.id}

    prediction = video_gen.status(job["p"])
    if prediction.status == "running":
        return {"status": "running"}
    if prediction.status == "failed":
        raise video_gen.VideoGenError(prediction.error or tr("Video üretilemedi.", "Could not generate the video."))

    with _job_lock(job["p"]):
        saved = _saved_video(db, shop, filename)  # aynı anda gelen ikinci sorgu kaydetmiş olabilir
        if saved is not None:
            return {"status": "done", "file_id": saved.id}
        data, mime = video_gen.download(prediction.output_url)
        out = save_file(db, shop, listing_id, "video", filename, mime, data)
        # Başlarken gösterilen fiyat düşülür (arada panelden fiyat değişse bile).
        model = catalog.ResolvedModel(job.get("m"), "video", job["pr"], job["mi"], job["mi"])
        metering.record_quoted("video", model, job.get("v"), job["d"], pricing.Price(job["u"], job["c"]))
    return {"status": "done", "file_id": out["file_id"]}

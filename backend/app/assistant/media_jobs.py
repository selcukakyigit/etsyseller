"""Çoklu medya üretimi: bir ya da birden çok listing/taslak için EK RESİMLER ve ürün VİDEOSU. Yalnızca kullanıcı isterse ("şu listing için 10 resim ve bir tanıtım videosu üret").

KREDİ HARCAR, bu yüzden iki aşamalıdır ve başlatma modelde DEĞİL kullanıcıdadır:
  1) PLAN: araç hiçbir şey üretmez; MALİYET KARTI çıkarır (listing başına resim/video, kredi, bakiye).
  2) ÜRETİM: kullanıcı karttaki [Üret]'e basınca arka planda sürer (listing başına sırayla, en çok WORKERS listing birlikte). Her adımdan önce bakiye denetlenir; yetmezse kalanlar durur,
     o ana dek üretilenler taslakta kalır. İlerleme kartta, [Durdur] ile kesilir.
Maliyet kartındaki rakam gerçek ücretle AYNI hesaptan gelir (`pricing`/`generation.quote_video`); üretilen resim ve video yalnızca YEREL TASLAĞA eklenir (Etsy'ye gitmez).

İşler bellekte tutulur (tek süreç; bkz. listings/rewrite.py): sunucu yeniden başlarsa iş kaybolur, o ana dek eklenenler taslakta kalır."""
import contextvars
import datetime as dt
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from app.ai import catalog, video_gen
from app.billing import credits, metering, pricing
from app.core.db import SessionLocal
from app.core.i18n import get_lang, tr
from app.listings import creation, generation
from app.shops.models import Shop

log = logging.getLogger(__name__)

MAX_LISTINGS = 15
MAX_IMAGES_PER_LISTING = 10
WORKERS = 2
VIDEO_SECONDS = (5, 10)  # sunulan süreler (Etsy 5-15 sn kabul eder; katalog desteğine göre doğrulanır)
VIDEO_WAIT_SECONDS = 12 * 60  # bir video için en çok bu kadar beklenir
VIDEO_POLL_SECONDS = 5
JOB_TTL_SECONDS = 6 * 3600
ACTIVE = ("running",)

# Her ek resim farklı bir çekimdir; ürünün kendisi değişmez (şekil, renk, yazı, ayrıntı).
SHOTS = (
    "a close-up detail shot that shows the material and finish of the product",
    "the product in a realistic, tasteful home setting where it is normally used, soft natural light",
    "the product from a different three-quarter angle on a clean neutral studio background",
    "a straight-on front view with a soft shadow on a clean neutral background",
    "the product in use or in a lived-in setting that shows its scale next to everyday objects",
    "a warm, cosy evening setting with soft lamp light",
    "a bright, minimal modern setting with lots of natural light",
    "an elegant gift-style presentation on a table, no wrapping text or brand names",
    "a natural outdoor or garden-style setting if the product suits it, otherwise a bright airy room",
    "a wide shot of a styled room where the product is clearly visible and the hero of the picture",
)
_PROMPT = (
    "Create a NEW, different product photo of this exact product. Do not change the product's shape, proportions, colours, text, pattern or any detail. Shot: {shot}. "
    "No text overlays, no watermarks, no logos or brand names that are not already on the product.{extra}"
)


# Seçenek modu ("her renk için bir görsel"): yalnızca seçeneğin adı (renk/yüzey) değişir; ürünün kendisi ve kadraj aynı kalır.
_OPTION_PROMPT = (
    "Create a NEW product photo of this exact product in the {variation} option '{option}': change ONLY the product's {variation} to {option} (a realistic {option} finish), "
    "and keep its shape, proportions, pattern, text and every other detail identical. Show the WHOLE product, fully visible and never cropped at any edge, on a clean neutral studio background. "
    "No text overlays, no watermarks, no logos or brand names that are not already on the product.{extra}"
)


# Ölçü varyasyonu ("Size", "Size&Scale", "Boyut"): görsel ürünün ölçüsünü gösterir; seçeneğin ölçü metni HARFİ HARFİNE yazılır (model rakam uydurmasın).
_SIZE_WORDS = ("size", "scale", "dimension", "boyut", "ölçü", "olcu")
_SIZE_PROMPT = (
    "Create a NEW product photo of this exact product drawn as a clean spec-sheet image that shows its size: add thin dimension lines with small arrowheads along the full width and the full height, "
    "each with a short, clearly readable label. Use EXACTLY this size text and no other numbers: '{option}'. Keep the product itself, its shape, proportions, pattern and every detail identical, fully visible and never cropped, "
    "on a clean neutral background with generous margins so the labels fit. No other text, watermarks, logos or brand names.{extra}"
)


def is_size_variation(name: str) -> bool:
    return any(w in name.lower() for w in _SIZE_WORDS)


@dataclass
class Job:
    shop_id: int
    workspace_id: int
    user_id: int
    session_id: int | None
    listings: list[dict]  # [{"listing_id", "title", "images" (eklenecek), "video" (bool), "credits"}]
    images_per_listing: int
    video: bool
    seconds: int
    instruction: str
    lang: str
    quote: dict
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "quote"  # quote → running → done | stopped
    results: dict[int, dict] = field(default_factory=dict)  # listing_id -> {images, video, errors, state}
    state: dict[int, str] = field(default_factory=dict)  # listing_id -> queued | running | done | failed | skipped
    stop_requested: bool = False
    started: bool = False
    note: str = ""  # "bakiye yetmedi" gibi iş düzeyinde not
    variation: str = ""  # dolu ise seçenek modu: bu varyasyonun (ör. Color) HER seçeneği için bir görsel üretilir ve seçeneğe bağlanır
    created: float = field(default_factory=time.time)


_JOBS: dict[str, Job] = {}
_lock = threading.Lock()


def get(job_id: str, shop_id: int) -> Job | None:
    """İş yalnızca kendi mağazasına aittir; başka mağazanın işi bulunamaz sayılır."""
    job = _JOBS.get(job_id)
    return job if job and job.shop_id == shop_id else None


def _prices(seconds: int, want_video: bool) -> tuple[int, int]:
    """(resim başına kredi, video başına kredi) — gerçek ücretle aynı hesap. Video istenmediyse 0."""
    _model, variant = catalog.resolve_choice("image")
    per_image = pricing.for_units(variant, 1).credits
    per_video = generation.quote_video(seconds)[2].credits if want_video else 0
    return per_image, per_video


def plan(db, shop: Shop, user_id: int, session_id: int | None, items: list[dict], images_per_listing: int, video: bool, seconds: int, instruction: str, variation: str = "") -> tuple[Job | None, str | None]:
    """Listing'leri ve istenen medyayı doğrular, maliyeti hesaplar, bekleyen (onay kartı) bir iş kurar. `items`: [{"listing_id", "title", "images" (şu an), "videos" (şu an), "options" (seçenek modunda varyasyonun seçenekleri)}]."""
    if not items:
        return None, tr("Listing belirtilmedi.", "No listing was given.")
    if len(items) > MAX_LISTINGS:
        return None, tr(f"Bir seferde en fazla {MAX_LISTINGS} listing için medya üretilir.", f"Media can be generated for at most {MAX_LISTINGS} listings at once.")
    if not 0 <= images_per_listing <= MAX_IMAGES_PER_LISTING:
        return None, tr(f"Listing başına en fazla {MAX_IMAGES_PER_LISTING} ek resim üretilir.", f"At most {MAX_IMAGES_PER_LISTING} extra images are generated per listing.")
    if images_per_listing == 0 and not video and not variation:
        return None, tr("Üretilecek bir şey belirtilmedi (resim sayısı ya da video).", "Nothing to generate was given (image count or video).")
    try:
        per_image, per_video = _prices(seconds, video)
    except (catalog.NotConfigured, ValueError) as exc:
        return None, str(exc)
    rows = []
    for it in items:
        slots = max(0, creation.MAX_LISTING_IMAGES - int(it.get("images") or 0))
        options = list(it.get("options") or [])[:MAX_IMAGES_PER_LISTING] if variation else []
        wanted = len(options) if variation else images_per_listing
        images = min(wanted, slots)
        options = options[:images]
        video_ok = video and int(it.get("videos") or 0) < generation.MAX_LISTING_VIDEOS and bool(it.get("images"))  # video bir fotoğraftan üretilir
        rows.append({
            "listing_id": it["listing_id"], "title": str(it.get("title") or "")[:120], "images": images, "video": video_ok,
            "credits": images * per_image + (per_video if video_ok else 0),
            "options": options, "skipped": [] + ([tr("Fotoğraf sınırı dolu", "Photo limit reached")] if images < wanted else []) + ([tr("Video eklenemez (fotoğraf yok ya da video sınırı dolu)", "Cannot add a video (no photo or video limit reached)")] if video and not video_ok else []),
        })
    total = sum(r["credits"] for r in rows)
    on = credits.enabled()
    quote = {
        "per_image": per_image, "per_video": per_video, "images": sum(r["images"] for r in rows), "videos": sum(1 for r in rows if r["video"]), "credits": total,
        "credits_enabled": on, "balance": credits.balance(db, shop.workspace_id) if on else None, "affordable": credits.can_afford(shop.workspace_id, total),
    }
    if quote["images"] == 0 and quote["videos"] == 0:
        return None, tr("Bu listing'lere eklenecek medya yok (fotoğraf/video sınırı dolu ya da fotoğraf yok).", "There is no media to add to these listings (photo/video limit reached or no photo).")
    now = time.time()
    with _lock:
        for jid in [k for k, j in _JOBS.items() if now - j.created > JOB_TTL_SECONDS and j.status not in ACTIVE]:
            del _JOBS[jid]
        job = Job(shop.id, shop.workspace_id, user_id, session_id, rows, images_per_listing, video, seconds, " ".join(str(instruction or "").split())[:300], get_lang(), quote, variation=variation)
        job.state = {r["listing_id"]: "queued" for r in rows}
        _JOBS[job.id] = job
    return job, None


def start(job: Job) -> str | None:
    """Kullanıcı [Üret]'e bastı. Bakiye yetmiyorsa hata metni döner (iş başlamaz); aksi halde arka planda başlar. İkinci çağrı etkisizdir."""
    with _lock:
        if job.status != "quote":
            return None
        if not credits.can_afford(job.workspace_id, job.quote["credits"]):
            return tr(f"Kredi yetersiz: bu iş {job.quote['credits']} kredi tutuyor.", f"Not enough credits: this job costs {job.quote['credits']} credits.")
        job.status = "running"
        job.started = True
    threading.Thread(target=contextvars.copy_context().run, args=(_run_all, job), daemon=True).start()
    return None


def stop(job: Job) -> None:
    """Başlamamış listing'ler atlanır; çalışan listing'in kalan adımları durur, üretilenler taslakta kalır. Onay bekleyen iş hemen kapanır."""
    job.stop_requested = True
    with _lock:
        if job.status == "quote":
            job.status = "stopped"
            job.state = {lid: "skipped" for lid in job.state}


def _run_all(job: Job) -> None:
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for fut in [pool.submit(contextvars.copy_context().run, _process, job, row) for row in job.listings]:
            fut.result()
    job.status = "stopped" if (job.stop_requested or any(s == "skipped" for s in job.state.values())) else "done"


def _process(job: Job, row: dict) -> None:
    lid = row["listing_id"]
    if job.stop_requested:
        job.state[lid] = "skipped"
        return
    job.state[lid] = "running"
    result = {"images": 0, "video": False, "errors": []}
    job.results[lid] = result
    try:
        _produce(job, row, result)
    except Exception as exc:  # noqa: BLE001 - tek listing'in hatası tüm işi durdurmaz
        log.exception("Medya işi: listing %s", lid)
        result["errors"].append(str(exc)[:160])
    ok = result["images"] > 0 or result["video"]
    job.state[lid] = "done" if ok or not result["errors"] else "failed"


def _ctx(db, shop: Shop, job: Job):
    from app.assistant import tools

    return tools.Ctx(db=db, shop=shop, user_id=job.user_id, today=dt.date.today(), session_id=job.session_id, unattended=True)


def _produce(job: Job, row: dict, result: dict) -> None:
    from app.assistant import tools

    db = SessionLocal()
    try:
        shop = db.get(Shop, job.shop_id)
        ctx = _ctx(db, shop, job)
        lid = row["listing_id"]
        work = tools._draft_work(ctx, lid)
        ordered, photo = tools._photo_at(work, 1)
        if photo is None:
            result["errors"].append(tr("Listing'de kaynak fotoğraf yok.", "The listing has no source photo."))
            return
        source = generation.source_photo(db, shop, lid, photo)
        if source is None:
            result["errors"].append(tr("Kaynak fotoğraf okunamadı.", "The source photo could not be read."))
            return
        for n in range(row["images"]):
            if job.stop_requested:
                return
            if not credits.can_afford(job.workspace_id, job.quote["per_image"]):
                job.note = tr("Kredi bitti; kalan üretimler durdu.", "Credits ran out; the remaining generations stopped.")
                return
            option = row["options"][n] if row.get("options") else None
            error = _make_image(job, ctx, lid, source, SHOTS[n % len(SHOTS)], prompt=_option_prompt(job, option) if option else None)
            if not error and option:
                link_error = _link_option(ctx, lid, job.variation, option)
                result["images"] += 1  # görsel eklendi; bağlanamadıysa uyarı olarak kalır
                if link_error:
                    result["errors"].append(link_error)
                continue
            if error:
                result["errors"].append(error)
                if "kota" in error.lower() or "quota" in error.lower():
                    return
                continue
            result["images"] += 1
        if result["images"]:
            tools.execute(ctx, "generate_missing_alt_texts", {"listing_id": lid})  # alt metni üretilen görsele bakarak yazılır
        if row["video"] and not job.stop_requested:
            if not credits.can_afford(job.workspace_id, job.quote["per_video"]):
                job.note = tr("Kredi bitti; video üretilemedi.", "Credits ran out; the video could not be generated.")
                return
            error = _make_video(job, ctx, lid, photo)
            if error:
                result["errors"].append(error)
            else:
                result["video"] = True
    finally:
        db.close()


def _option_prompt(job: Job, option: str) -> str:
    extra = f" Direction from the seller: {job.instruction}" if job.instruction else ""
    template = _SIZE_PROMPT if is_size_variation(job.variation) else _OPTION_PROMPT
    return template.format(variation=job.variation, option=option, extra=extra)


def _link_option(ctx, lid: int, variation: str, option: str) -> str | None:
    """Az önce eklenen (son sıradaki) fotoğrafı varyasyon seçeneğine bağlar. Hata metni ya da None."""
    from app.assistant import tools

    work = tools._draft_work(ctx, lid)
    ordered, _ = tools._photo_at(work, 1)
    out = tools.execute(ctx, "set_variation_photo", {"listing_id": lid, "variation": variation, "option": option, "photo_number": len(ordered)})
    errors = out.get("hatalar") or ([out["error"]] if out.get("error") else [])
    if not errors:
        return None
    detail = "; ".join(str(e) for e in errors)[:140]
    return tr(f"{option}: görsel eklendi ama seçeneğe bağlanamadı ({detail}).", f"{option}: the image was added but could not be linked to the option ({detail}).")


def _make_image(job: Job, ctx, lid: int, source: tuple[bytes, str], shot: str, prompt: str | None = None) -> str | None:
    """Tek ek resim: üretir ve listing taslağına son sıraya ekler. Hata metni ya da None."""
    from app.ai.image_gen import ImageGenError, guess_extension, regenerate_image
    from app.assistant import tools

    extra = f" Direction from the seller: {job.instruction}" if job.instruction else ""
    try:
        with metering.bind(metering.Scope(job.workspace_id, job.user_id)):
            data, mime = regenerate_image(source[0], source[1], prompt or _PROMPT.format(shot=shot, extra=extra))
    except (ImageGenError, ValueError, FileNotFoundError) as exc:
        return str(exc)[:160]
    bad, _photo_id = tools._add_photo(ctx, lid, f"ai-media{guess_extension(mime)}", mime, data)
    return bad


def _make_video(job: Job, ctx, lid: int, photo: dict) -> str | None:
    """Ürün videosu: listing'in ilk fotoğrafından üretilir, bitene dek beklenir ve taslağa eklenir. Hata metni ya da None."""
    from app.assistant import tools

    ref = generation.Reference(image_id=photo["listing_image_id"], image_draft_file_id=photo.get("draft_file_id"))
    try:
        with metering.bind(metering.Scope(job.workspace_id, job.user_id)):
            started = generation.start_video(ctx.db, ctx.shop, lid, job.instruction or generation.DEFAULT_VIDEO_PROMPT, job.seconds, ref)
            end = time.time() + VIDEO_WAIT_SECONDS
            while True:
                if job.stop_requested:
                    return tr("Durduruldu; video tamamlanmadı.", "Stopped; the video was not completed.")
                state = generation.poll_video(ctx.db, ctx.shop, lid, started["job"])
                if state["status"] == "done":
                    file_id = state["file_id"]
                    break
                if time.time() > end:
                    return tr("Video zamanında hazırlanamadı.", "The video was not ready in time.")
                time.sleep(VIDEO_POLL_SECONDS)
    except generation.InsufficientCredits as exc:
        return tr(f"Video için {exc.needed} kredi gerekiyor; bakiye yetmedi.", f"The video needs {exc.needed} credits; the balance was not enough.")
    except (video_gen.VideoGenError, ValueError, LookupError) as exc:
        return str(exc)[:160]
    result = tools.execute(ctx, "add_video_to_listing", {"listing_id": lid, "file_id": file_id})
    return str(result["error"])[:160] if isinstance(result, dict) and result.get("error") else None


def public(job: Job) -> dict:
    """Arayüzün sorguladığı durum: maliyet, listing başına plan ve (başladıysa) sonuç."""
    rows = []
    for r in job.listings:
        res = job.results.get(r["listing_id"], {})
        rows.append({
            "listing_id": r["listing_id"], "title": r["title"], "images": r["images"], "video": r["video"], "credits": r["credits"], "skipped": r["skipped"], "options": r.get("options", []),
            "state": job.state.get(r["listing_id"], "queued"), "images_done": res.get("images", 0), "video_done": res.get("video", False), "errors": res.get("errors", []),
        })
    states = list(job.state.values())
    return {
        "job_id": job.id, "status": job.status, "quote": job.quote, "items": rows, "note": job.note, "variation": job.variation, "done": states.count("done"), "failed": states.count("failed"),
        "running": states.count("running"), "skipped": states.count("skipped"), "seconds": job.seconds, "images_total": sum(r["images_done"] for r in rows), "videos_total": sum(1 for r in rows if r["video_done"]),
    }

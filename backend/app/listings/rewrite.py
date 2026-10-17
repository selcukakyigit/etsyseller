"""Toplu yapay zekâ yeniden yazımı: birçok listing'in başlık / etiket / açıklamasını tek tek SEO önerisiyle yeniden yazar.

Akış: önce SAMPLE_COUNT listing yazılır (önizleme), kullanıcı onaylayınca kalanı arka planda sırayla yapılır. Her sonuç YEREL TASLAK olur (Etsy'ye gitmez);
bitince sonuç, toplu işlemlerin ortak sonuç kartına (bulk_result) dönüşür. Üretim `listings.service.generate_for_listing`, kayıt `bulk.stage_edit`,
seçim `selection.select_rows`'tur: tek listing önerisindeki tüm kalite denetimleri aynen geçerlidir.

İşler bellekte tutulur (tek süreç; sunucu yeniden başlarsa iş kaybolur ama o ana dek yazılanlar yerel taslakta kalır). Ölçek büyüyünce Redis + ayrı worker'a taşınır."""
import contextvars
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from sqlalchemy import select

from app.ai.catalog import NotConfigured
from app.billing import credits, metering
from app.core.db import SessionLocal
from app.core.i18n import tr
from app.listings import bulk, service
from app.listings.models import ListingCache
from app.shops.models import Shop

log = logging.getLogger(__name__)

FIELDS = ("title", "tags", "description")
SAMPLE_COUNT = 2
CREDITS_PER_LISTING = 3  # ölçülen ortalama (öneri üretimi + gerekirse kalite yeniden denemesi)
CONFIRM_ABOVE_LISTINGS = 20  # bunun üstündeki işler tahmini söylenip onay alınmadan başlamaz
CONFIRM_ABOVE_CREDITS = 60
JOB_TTL_SECONDS = 6 * 3600


@dataclass
class Job:
    shop_id: int
    workspace_id: int
    user_id: int
    listing_ids: list[int]
    fields: tuple[str, ...]
    instruction: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "preview"  # preview → running → done | stopped | out_of_credits
    results: dict[int, dict] = field(default_factory=dict)  # listing_id → {ok, changed, error, title, before, after, detail}
    stop_requested: bool = False
    created: float = field(default_factory=time.time)
    started: bool = False


_JOBS: dict[str, Job] = {}
_lock = threading.Lock()


def estimate(n: int) -> dict:
    credits_needed = n * CREDITS_PER_LISTING
    return {"listings": n, "credits": credits_needed, "needs_confirmation": n > CONFIRM_ABOVE_LISTINGS or credits_needed > CONFIRM_ABOVE_CREDITS}


def get(job_id: str, shop_id: int) -> Job | None:
    """İş yalnızca kendi mağazasına aittir; başka mağazanın işi bulunamaz sayılır."""
    job = _JOBS.get(job_id)
    return job if job and job.shop_id == shop_id else None


def create(shop: Shop, user_id: int, listing_ids: list[int], fields: tuple[str, ...], instruction: str) -> Job:
    now = time.time()
    with _lock:
        for jid in [k for k, j in _JOBS.items() if now - j.created > JOB_TTL_SECONDS and j.status != "running"]:
            del _JOBS[jid]
        job = Job(shop.id, shop.workspace_id, user_id, listing_ids, fields, instruction)
        _JOBS[job.id] = job
    return job


def _edit(fields: tuple[str, ...], suggestion: dict, detail: dict):
    def edit(work: dict) -> str | None:
        detail["before"] = {k: work.get(k) for k in FIELDS}
        if "title" in fields and suggestion.get("title"):
            work["title"] = suggestion["title"]
        if "tags" in fields and suggestion.get("tags"):
            work["tags"] = list(suggestion["tags"])
        if "description" in fields and suggestion.get("description"):
            work["description"] = suggestion["description"]
        detail["after"] = {k: work.get(k) for k in FIELDS}
        return None

    return edit


def _rewrite_one(job: Job, listing_id: int) -> dict:
    """Tek listing: öneriyi üret, seçili alanları yerel taslağa yaz. Kendi oturumunu açar (iş parçacığından çağrılır)."""
    db = SessionLocal()
    try:
        shop = db.get(Shop, job.shop_id)
        row = db.scalars(select(ListingCache).where(ListingCache.shop_id == job.shop_id).where(ListingCache.listing_id == listing_id)).one_or_none()
        if shop is None or row is None:
            return {"id": listing_id, "ok": False, "changed": False, "error": tr("Listing yerelde yok (senkronize et).", "Listing is not synced locally."), "title": ""}
        with metering.bind(metering.Scope(job.workspace_id, job.user_id)):
            try:
                _listing, suggestion = service.generate_for_listing(db, shop, listing_id, instruction=job.instruction)
            except (service.SuggestionError, NotConfigured) as exc:
                return {"id": listing_id, "ok": False, "changed": False, "error": str(exc)[:160], "title": row.title or ""}
        detail: dict = {}
        res = bulk.stage_edit(db, shop, listing_id, row, _edit(job.fields, suggestion, detail))
        res["detail"] = detail
        res["warnings"] = suggestion.get("warnings", [])
        return res
    except Exception as exc:  # noqa: BLE001 - tek listing'in hatası tüm işi durdurmaz
        log.exception("Toplu yeniden yazım: listing %s", listing_id)
        return {"id": listing_id, "ok": False, "changed": False, "error": str(exc)[:160], "title": ""}
    finally:
        db.close()


def run_preview(job: Job) -> None:
    """İlk SAMPLE_COUNT listing'i paralel yazar (önizleme). Kullanıcı kredi hesabı kapalıysa bile aynen çalışır."""
    ids = job.listing_ids[:SAMPLE_COUNT]
    with ThreadPoolExecutor(max_workers=SAMPLE_COUNT) as pool:
        futures = [pool.submit(contextvars.copy_context().run, _rewrite_one, job, lid) for lid in ids]
        for lid, fut in zip(ids, futures):
            job.results[lid] = fut.result()
    if len(job.results) >= len(job.listing_ids):  # tüm hedef zaten örneklerden ibaretti: onaylanacak kalan yok
        job.started = True
        job.status = "done"


def _run_rest(job: Job) -> None:
    for lid in job.listing_ids:
        if lid in job.results:
            continue
        if job.stop_requested:
            job.status = "stopped"
            return
        if not credits.can_afford(job.workspace_id, CREDITS_PER_LISTING):
            job.status = "out_of_credits"
            return
        job.results[lid] = _rewrite_one(job, lid)
    job.status = "done"


def start(job: Job) -> bool:
    """Önizleme onaylandı: kalanı arka planda sırayla yaz. İkinci çağrı etkisizdir."""
    with _lock:
        if job.started:
            return False
        job.started = True
        job.status = "running"
    ctx = contextvars.copy_context()
    threading.Thread(target=ctx.run, args=(_run_rest, job), daemon=True).start()
    return True


def stop(job: Job) -> None:
    job.stop_requested = True
    if not job.started:
        job.status = "stopped"


def public(job: Job) -> dict:
    """Arayüzün sorguladığı durum: ilerleme, önizleme örnekleri ve (yazılanlar için) toplu sonuç kartı bilgisi."""
    from collections import Counter

    results = list(job.results.values())
    done = [r for r in results if r["ok"] and r["changed"]]
    skipped = Counter(("zaten aynı" if r["ok"] else r["error"]) for r in results if not (r["ok"] and r["changed"]))
    samples = [
        {"id": r["id"], "title": r["title"][:70], "before": r["before"], "after": r["after"], "detail": r["detail"], "warnings": r.get("warnings", [])}
        for r in done[:SAMPLE_COUNT]
    ]
    return {
        "job_id": job.id, "status": job.status, "total": len(job.listing_ids), "processed": len(results), "fields": list(job.fields),
        "samples": samples, "listing_ids": [r["id"] for r in done], "changed": len(done),
        "skipped": [{"reason": reason, "count": n} for reason, n in skipped.most_common(6)],
        "estimate": estimate(len(job.listing_ids) - len(results)),
    }

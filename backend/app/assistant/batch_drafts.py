"""Toplu yeni listing: birden çok ürünün resminden HER BİRİ İÇİN AYRI yerel taslak (en fazla MAX_ITEMS ürün).

Serbest dolaşan bir agent değil, kontrollü bir iş: ana asistan `create_listings_from_images` ile ürünleri (resim kimlikleri + kullanıcının o ürün için
söyledikleri) ve ortak bilgileri verir; sunucu her ürün için ASİSTANIN TEK LİSTİNG AKIŞINI (aynı istem, aynı araçlar, aynı `create_listing_draft`) ayrı bir
alt çalıştırmada koşar. İkinci bir oluşturma kodu yoktur; fark yalnızca alt çalıştırmanın kullanıcıya soru soramamasıdır (fiyat gibi bilinmeyen boş kalır).

Neden ayrı alt çalıştırma: model bir mesajdaki yalnızca ilk MODEL_IMAGES_PER_MESSAGE resmi görür ve bir istek MAX_ROUNDS tur ile sınırlıdır; her ürün kendi resimlerini
görür ve kendi turlarına sahiptir. Hata yalıtılır (biri düşse diğerleri biter), ürünler en çok WORKERS tane birlikte işlenir. Alt çalıştırmaların iç konuşması sohbet
geçmişine yazılmaz; sohbette tek ilerleme kartı vardır (`batch_job`).

Kurallar: yalnızca YEREL TASLAK (Etsy'ye hiçbir şey gitmez); resim/video ÜRETİLMEZ (kredi harcanmaz; kullanıcının yüklediği resimler kullanılır). Fiyat tahmin edilmez.
İşler bellekte tutulur (tek süreç; bkz. listings/rewrite.py): sunucu yeniden başlarsa iş kaybolur, o ana dek oluşan taslaklar yerelde kalır."""
import contextvars
import datetime as dt
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from app.assistant import llm, memory, prompt
from app.billing import metering
from app.core.db import SessionLocal
from app.core.i18n import get_lang, tr
from app.listings import creation, etsy_rules
from app.shops.models import Shop

log = logging.getLogger(__name__)

MAX_ITEMS = 15
MAX_IMAGES_PER_ITEM = creation.MAX_LISTING_IMAGES
WORKERS = 2
JOB_TTL_SECONDS = 6 * 3600
ATTEMPTS = 2  # model taslağı kurmadan bitirirse bir kez "şimdi kur" denir

# Alt çalıştırmanın kullanabildiği araçlar: araştırma + taslak kurma/tamamlama. Soru sorma (ask_user, brief_check), yayınlama, silme, resim/video üretimi YOK.
ITEM_TOOLS = frozenset({
    "shop_defaults", "shop_options", "similar_listings", "find_category", "keyword_pool", "get_category_attributes", "set_listing_attributes", "autofill_listing_attributes",
    "create_listing_draft", "update_listing", "set_listing_fields", "get_listing", "generate_missing_alt_texts", "list_description_templates",
})

_NOTE = (
    "SİSTEM: Bu bir OTOMATİK TOPLU İŞ (ürün {n}/{total}). Kullanıcıya soru soramazsın: ask_user ve brief_check YOK. Bilinmeyeni (fiyat gibi) BOŞ bırak, tahmin etme; "
    "başka şeyleri (ürünün adı, türü, malzeme, kategori, başlık, etiket, açıklama) resimlerden kendin çıkar, resimde görmediğini uydurma. Yalnızca BU TEK ürün için, "
    "yani aşağıdaki resimlerle, create_listing_draft'ı çağır (image_ids: bu ürünün TÜM resimleri). Önce gerekirse keyword_pool / similar_listings / shop_defaults / find_category; "
    "resim/video üretme, yayınlama yok. Dijital ürünse (PDF, şablon, printable…) listing_type=\"download\". Taslak oluşunca tek cümleyle bitir."
)


@dataclass
class Item:
    index: int  # 1'den başlar (kullanıcıya gösterilen sıra)
    image_ids: list[str]
    note: str = ""  # kullanıcının bu ürün için söyledikleri (ad, fiyat, tür…)


@dataclass
class Job:
    shop_id: int
    workspace_id: int
    user_id: int
    session_id: int | None
    items: list[Item]
    shared: str  # tüm ürünler için ortak bilgi (fiyat, stok, varyasyon…): kullanıcının sözü
    lang: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "running"  # running | done | stopped
    state: dict[int, str] = field(default_factory=dict)  # ürün sırası -> queued | running | done | failed | skipped
    results: dict[int, dict] = field(default_factory=dict)
    stop_requested: bool = False
    started: bool = False
    created: float = field(default_factory=time.time)


_JOBS: dict[str, Job] = {}
_lock = threading.Lock()


def get(job_id: str, shop_id: int) -> Job | None:
    """İş yalnızca kendi mağazasına aittir; başka mağazanın işi bulunamaz sayılır."""
    job = _JOBS.get(job_id)
    return job if job and job.shop_id == shop_id else None


def create_job(db, shop: Shop, user_id: int, session_id: int | None, items: list, shared: str) -> tuple[Job | None, str | None]:
    """Girdiyi doğrular (sınırlar, resimlerin bu mağazaya ait olması, aynı resmin iki üründe olmaması) ve işi kurar. Döner: (iş, hata)."""
    from app.assistant import service

    if not isinstance(items, list) or not items:
        return None, tr("Ürün listesi boş: her ürün için image_ids ver.", "The product list is empty: give image_ids for each product.")
    if len(items) > MAX_ITEMS:
        return None, tr(f"Bir seferde en fazla {MAX_ITEMS} ürün oluşturulur ({len(items)} verildi).", f"At most {MAX_ITEMS} products can be created at once ({len(items)} given).")
    seen: set[str] = set()
    out: list[Item] = []
    for n, raw in enumerate(items, start=1):
        ids = [str(i) for i in (raw.get("image_ids") or [])] if isinstance(raw, dict) else []
        if not ids:
            return None, tr(f"{n}. üründe resim yok.", f"Product {n} has no images.")
        if len(ids) > MAX_IMAGES_PER_ITEM:
            return None, tr(f"{n}. üründe en fazla {MAX_IMAGES_PER_ITEM} resim olabilir.", f"Product {n} can have at most {MAX_IMAGES_PER_ITEM} images.")
        for iid in ids:
            img = service.get_image(db, shop, iid)
            if img is None or not img.path or img.content_type not in service.IMAGE_TYPES:
                return None, tr(f"{n}. üründeki resim bulunamadı ya da resim değil: {iid}", f"A product {n} image was not found or is not an image: {iid}")
            if iid in seen:
                return None, tr(f"Aynı resim iki ürüne verilmiş: {iid}", f"The same image was given to two products: {iid}")
            seen.add(iid)
        out.append(Item(n, ids, " ".join(str(raw.get("note") or "").split())[:500]))
    now = time.time()
    with _lock:
        for jid in [k for k, j in _JOBS.items() if now - j.created > JOB_TTL_SECONDS and j.status != "running"]:
            del _JOBS[jid]
        job = Job(shop.id, shop.workspace_id, user_id, session_id, out, " ".join(str(shared or "").split())[:800], get_lang())
        job.state = {i.index: "queued" for i in out}
        _JOBS[job.id] = job
    return job, None


def start(job: Job) -> bool:
    """İşi arka planda başlatır; ikinci çağrı etkisizdir."""
    with _lock:
        if job.started:
            return False
        job.started = True
    threading.Thread(target=contextvars.copy_context().run, args=(_run_all, job), daemon=True).start()
    return True


def stop(job: Job) -> None:
    """Başlamamış ürünler atlanır; çalışanlar biter (yarım taslak bırakılmaz)."""
    job.stop_requested = True


def _run_all(job: Job) -> None:
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(contextvars.copy_context().run, _process, job, item) for item in job.items]
        for fut in futures:
            fut.result()
    job.status = "stopped" if any(s == "skipped" for s in job.state.values()) else "done"


def _process(job: Job, item: Item) -> None:
    if job.stop_requested:
        job.state[item.index] = "skipped"
        return
    job.state[item.index] = "running"
    try:
        result = _run_item(job, item)
    except Exception as exc:  # noqa: BLE001 - tek ürünün hatası tüm işi durdurmaz
        log.exception("Toplu listing: ürün %s", item.index)
        result = {"ok": False, "error": str(exc)[:200]}
    job.results[item.index] = result
    job.state[item.index] = "done" if result.get("ok") else "failed"


def _sibling_titles(job: Job) -> list[str]:
    return [r["title"] for r in job.results.values() if r.get("ok") and r.get("title")]


def _run_item(job: Job, item: Item) -> dict:
    """Tek ürün: kendi veritabanı oturumu ve bağlamıyla asistanın listing akışını koşar; sonuç: {ok, listing_id, title, missing, warnings, error}."""
    from app.assistant import service, tools

    db = SessionLocal()
    try:
        shop = db.get(Shop, job.shop_id)
        images = [img for iid in item.image_ids if (img := service.get_image(db, shop, iid)) is not None and img.path]
        if shop is None or not images:
            return {"ok": False, "error": tr("Resimler bulunamadı (süresi dolmuş olabilir).", "The images were not found (they may have expired).")}
        ctx = tools.Ctx(db=db, shop=shop, user_id=job.user_id, today=dt.date.today(), message=item.note, session_id=job.session_id, unattended=True)
        drafted: dict = {}
        last_error: list[str] = []

        def execute(name: str, args: dict) -> dict:
            if name not in ITEM_TOOLS:
                return {"error": tr("Bu araç toplu işte kullanılamaz.", "This tool is not available in a batch job.")}
            result = tools.execute(ctx, name, args)
            if isinstance(result, dict):
                if name == "create_listing_draft" and result.get("listing_id"):
                    drafted.update(result, _title=etsy_rules.clean_title(str(args.get("title", ""))))
                if result.get("error"):
                    last_error[:] = [str(result["error"])[:300]]
            return result

        model = llm.assistant_model()
        seen = [{"path": i.path, "content_type": i.content_type} for i in images][: service.MODEL_IMAGES_PER_MESSAGE]
        static = prompt.static_rules("listing", frozenset({"market", "digital"}))
        dynamic = prompt.shop_context(
            shop_name=shop.shop_name, today=dt.date.today().isoformat(), currency=service._currency(db, shop), sections=service._sections_summary(db, shop),
            examples=service._title_examples(db, shop), files=service._images_prompt(images), notes=memory.notes_for_prompt(db, shop.id), lang=job.lang,
        )
        schemas = [t for t in tools.TOOLS if t["name"] in ITEM_TOOLS]
        for attempt in range(ATTEMPTS):
            text = _text(job, item, _sibling_titles(job), retry=attempt > 0)
            with metering.bind(metering.Scope(job.workspace_id, job.user_id)):
                result = llm.run_agent(model, static, dynamic, [], text, seen, schemas, execute)
                if job.session_id is not None:
                    service._record_usage(db, shop.id, job.user_id, job.session_id, result.usage)
                metering.record("assistant", model, result.usage.input_tokens, result.usage.output_tokens)
            db.commit()
            if drafted:
                break
        if not drafted:
            return {"ok": False, "error": last_error[0] if last_error else tr("Taslak oluşturulamadı.", "The draft could not be created.")}
        missing = list(drafted.get("yayin_icin_eksikler") or [])
        if drafted.get("dijital_dosya_eksik"):
            missing.append(tr("Dijital ürün: indirilebilir dosya eksik.", "Digital product: the downloadable file is missing."))
        return {"ok": True, "listing_id": drafted["listing_id"], "title": drafted.get("_title", ""), "missing": [str(m) for m in missing], "warnings": [str(w) for w in drafted.get("kalite_uyarilari") or []]}
    finally:
        db.close()


def _text(job: Job, item: Item, siblings: list[str], retry: bool) -> str:
    parts = [_NOTE.format(n=item.index, total=len(job.items))]
    parts.append(f"Bu ürünün resim kimlikleri: {', '.join(item.image_ids)}")
    if item.note:
        parts.append(f"Kullanıcının bu ürün için söyledikleri: {item.note}")
    if job.shared:
        parts.append(f"Tüm ürünler için ortak bilgiler (fiyat, stok, varyasyon…): {job.shared}")
    if siblings:
        parts.append("Aynı toplu işte hazırlanan diğer ürünlerin başlıkları (kopyalama; farklı uzun kuyruklu ifadeleri hedefle): " + " | ".join(siblings[-14:]))
    if retry:
        parts.append("ÖNCEKİ DENEMEDE TASLAK KURULMADI: araç hatalarını kendin düzelt ve create_listing_draft'ı ŞİMDİ çağır; soru sorma, yazıyla cevap verme.")
    return "\n".join(parts)


def public(job: Job) -> dict:
    """Arayüzün sorguladığı durum: ürün başına durum ve sonuç, toplamlar."""
    rows = []
    for item in job.items:
        r = job.results.get(item.index, {})
        rows.append({
            "index": item.index, "images": len(item.image_ids), "state": job.state.get(item.index, "queued"), "listing_id": r.get("listing_id"),
            "title": r.get("title", ""), "missing": r.get("missing", []), "warnings": r.get("warnings", []), "error": r.get("error", ""),
        })
    states = list(job.state.values())
    return {
        "job_id": job.id, "status": job.status, "total": len(job.items), "done": states.count("done"), "failed": states.count("failed"),
        "skipped": states.count("skipped"), "running": states.count("running"), "items": rows,
        "listing_ids": [r["listing_id"] for r in rows if r["listing_id"]],
    }

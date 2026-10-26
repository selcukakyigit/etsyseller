"""Toplu yeni listing: birden çok ürünün resminden HER BİRİ İÇİN AYRI yerel taslak (en fazla MAX_ITEMS ürün).

Serbest dolaşan bir agent değil, kontrollü ve İKİ AŞAMALI bir iş:
  1) ÇÖZÜMLEME: her ürün için bir model çağrısı resme ve kullanıcının sözüne bakıp ürünü çıkarır (`report_product`): ad, tür, ölçü/kapasite, malzeme, kişiselleştirme, tahmini
     ağırlık. Kategori, rakiplerin kategori dağılımından seçilir (etsy_top). Sonuç kartta düzenlenebilir bir ÖN KONTROLdür; kullanıcı onaylar ("Taslakları oluştur") ya da
     baştan "sormadan yap" demişse onay beklenmez.
  2) OLUŞTURMA: her ürün için ASİSTANIN TEK LİSTİNG AKIŞI (aynı istem, aynı araçlar, aynı `create_listing_draft`) ayrı bir alt çalıştırmada koşar; onaylanan bilgiler olgu sayılır.
İkinci bir oluşturma kodu yoktur; fark yalnızca alt çalıştırmanın kullanıcıya soru soramamasıdır.

Olgu kuralı: ölçü/kapasite ve malzeme yalnızca kullanıcı söylediyse ya da resimde okunuyorsa yazılır; bilinmiyorsa BOŞ kalır ve ön kontrolde vurgulanır (uydurulmaz). Ağırlık gibi düşük riskli
alanlar tahmin edilir ve "tahmini" diye işaretlenir. Fiyat tahmin edilmez.

Neden ürün başına çalıştırma: model bir mesajdaki yalnızca ilk MODEL_IMAGES_PER_MESSAGE resmi görür ve bir istek MAX_ROUNDS tur ile sınırlıdır; her ürün kendi resimlerini görür ve kendi
turlarına sahiptir. Hata yalıtılır, ürünler en çok WORKERS tane birlikte işlenir. Alt çalıştırmaların iç konuşması sohbet geçmişine yazılmaz; sohbette tek kart vardır (`batch_job`).

Yalnızca YEREL TASLAK (Etsy'ye hiçbir şey gitmez); resim/video ÜRETİLMEZ. İşler bellekte tutulur (tek süreç; bkz. listings/rewrite.py): sunucu yeniden başlarsa iş kaybolur,
o ana dek oluşan taslaklar yerelde kalır."""
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
WORKERS = 2  # oluşturma (ağır): aynı anda en çok bu kadar ürün
ANALYSIS_WORKERS = 3  # çözümleme (hafif, tek model çağrısı)
JOB_TTL_SECONDS = 6 * 3600
ATTEMPTS = 2  # model taslağı kurmadan bitirirse bir kez "şimdi kur" denir
MIN_CATEGORY_SHARE = 0.4  # rakiplerin en az bu oranı aynı kategorideyse varsayılan o olur (yoksa kategoriyi oluşturma adımı seçer)
WEIGHT_UNITS = ("oz", "lb", "g", "kg")
ACTIVE = ("analyzing", "running")  # arka planda çalışan durumlar (süresi dolsa da silinmez)

# Alt çalıştırmanın kullanabildiği araçlar: araştırma + taslak kurma/tamamlama. Soru sorma (ask_user, brief_check), yayınlama, silme, resim/video üretimi YOK.
ITEM_TOOLS = frozenset({
    "shop_defaults", "shop_options", "similar_listings", "find_category", "keyword_pool", "get_category_attributes", "set_listing_attributes", "autofill_listing_attributes",
    "create_listing_draft", "update_listing", "set_listing_fields", "get_listing", "generate_missing_alt_texts", "list_description_templates",
})

# Toplu işte KULLANILMAYAN listing araçları (bilinçli karar kaydı). Yeni bir listing aracı eklenince ITEM_TOOLS ya da buraya konmalı: tests/test_batch_drafts.py bunu denetler,
# böylece "normal asistana eklendi ama toplu iş bilmiyor" durumu sessizce oluşmaz.
BATCH_DENIED = frozenset({
    # kullanıcıya soru sorar / sohbet kartı üretir
    "ask_user", "brief_check",
    # toplu işin kendisi ve toplu işlem araçları
    "create_listings_from_images", "start_batch_listings", "batch_listings_status", "stop_batch_listings", "bulk_update_listings", "rewrite_listings", "continue_rewrite", "stop_rewrite",
    # Etsy'ye giden ya da geri dönüşü zor işler (yayınlama, kapatma, silme)
    "publish_listing_draft", "deactivate_listing", "delete_listing", "discard_listing_changes", "copy_listing",
    # resim/video üretimi ve düzenleme (karar A: toplu işte üretilmez, kredi harcar)
    "generate_chat_image", "edit_chat_image", "add_chat_image_to_listing", "regenerate_listing_image", "upscale_listing_photo", "crop_listing_photo", "delete_listing_photo", "move_listing_photo",
    "set_photo_alt_text", "set_variation_photo", "generate_listing_video", "add_video_to_listing", "remove_listing_video", "generation_options", "make_pin_image", "pinterest_content",
    # taslak sonrası ince ayar (şimdilik sohbetten tek tek): varyasyon, stok, kişiselleştirme, dijital dosya, tür
    "edit_inventory", "add_variation_option", "remove_variation_option", "edit_personalization_question", "personalization_library", "add_digital_file", "remove_digital_file", "set_listing_type",
    # araştırma ve çözümleme (ön kontrol zaten rakipleri tarar; kullanıcıya özel analizler sohbette)
    "search_listings", "analyze_listing_values", "listing_health_status", "workspace_status", "market_research", "suggest_price", "research_keywords", "keyword_detail", "upcoming_seasons",
    "saved_keywords", "save_keywords", "etsy_top_results",
    # şablon yönetimi, hafıza, destek: kullanıcı kararı
    "save_description_template", "delete_description_templates", "remember_note", "forget_note", "open_support_ticket", "my_support_tickets",
})

_CREATE_NOTE = (
    "SİSTEM: Bu bir OTOMATİK TOPLU İŞ (ürün {n}/{total}). Kullanıcıya soru soramazsın: ask_user ve brief_check YOK. Bilinmeyeni (fiyat gibi) BOŞ bırak, tahmin etme; "
    "başka şeyleri (başlık, etiket, açıklama) resimlerden ve aşağıdaki onaylı bilgilerden kendin yaz; resimde ya da onaylı bilgide olmayan ölçü, kapasite, malzeme, bakım, gravür/nakış gibi "
    "ÖZELLİK UYDURMA (fiyat ve adet bir özellik DEĞİLDİR; kapasite/ölçü olarak yazma). Yalnızca BU TEK ürün için, yani aşağıdaki resimlerle, create_listing_draft'ı çağır "
    "(image_ids: bu ürünün TÜM resimleri). Önce gerekirse keyword_pool / similar_listings / shop_defaults; resim/video üretme, yayınlama yok. Açıklamanın ürüne özel kısmı dolu olsun "
    "(alıcının sorularına cevap veren, 80-200 kelime), ama yalnızca bilinen olgularla. Taslak oluşunca tek cümleyle bitir."
)

_ANALYSIS_RULES = (
    "Sen bir Etsy ürün çözümleyicisisin. Görevin: ürün resimlerine ve kullanıcının sözlerine bakıp report_product aracını TEK kez çağırmak. KURALLAR: "
    "(1) ölçü/kapasite ve malzemeyi YALNIZCA kullanıcı söylediyse ya da resimde okunabiliyorsa yaz; yoksa boş bırak ve unsure listesine ekle. Fiyat ve adet (ör. '20 dolar', '20 adet') ölçü ya da kapasite DEĞİLDİR. "
    "(2) Kişiselleştirme: kullanıcının sözünden bu ürün için var mı yok mu çıkar (ör. 'duvar dekoru hariç hepsinde var'); ne tür olduğunu (gravür, nakış, isim yazımı) kullanıcı söylemediyse detay boş kalsın ve unsure'a ekle. "
    "(3) Ağırlık: bu tür ürünün gerçekçi paketli ağırlığını TAHMİN et (sayı + birim); her zaman ver. "
    "(4) name: ürünün kısa İngilizce adı; phrase: alıcıların arayacağı kısa İngilizce arama ifadesi (ör. 'insulated tumbler with handle'). Marka/karakter adı yazma. "
    "(5) Dijital ürün (PDF, şablon, printable) ise digital=true. Başka bir şey yapma, soru sorma."
)

REPORT_TOOL = {
    "name": "report_product",
    "description": "Çözümlenen ürünü bildirir (TEK kez çağır).",
    "input_schema": {"type": "object", "properties": {
        "name": {"type": "string", "description": "Ürünün kısa İngilizce adı"},
        "phrase": {"type": "string", "description": "Alıcıların arayacağı kısa İngilizce arama ifadesi"},
        "digital": {"type": "boolean"},
        "size": {"type": "string", "description": "Ölçü ya da kapasite; yalnızca kullanıcı söylediyse/resimde okunuyorsa, yoksa boş"},
        "material": {"type": "string", "description": "Malzeme; yalnızca kullanıcı söylediyse/resimde belliyse, yoksa boş"},
        "personalizable": {"type": "boolean", "description": "Kullanıcının sözüne göre bu ürün kişiselleştirilebiliyor mu"},
        "personalization_detail": {"type": "string", "description": "Kişiselleştirmenin türü (isim gravürü, nakış…); söylenmediyse boş"},
        "weight_value": {"type": "number", "description": "Paketli ağırlık TAHMİNİ"},
        "weight_unit": {"type": "string", "enum": list(WEIGHT_UNITS)},
        "unsure": {"type": "array", "items": {"type": "string", "enum": ["size", "material", "personalization_detail"]}, "description": "Bilinmeyen ama önemli olan alanlar"},
    }, "required": ["name", "phrase", "digital", "personalizable", "weight_value", "weight_unit"]},
}


@dataclass
class Item:
    index: int  # 1'den başlar (kullanıcıya gösterilen sıra)
    image_ids: list[str]
    note: str = ""  # kullanıcının bu ürün için söyledikleri (ad, fiyat, tür…)
    spec: dict = field(default_factory=dict)  # çözümleme sonucu; ön kontrolde kullanıcı düzenler (bkz. _spec_from_report)
    analyzed: bool = False


@dataclass
class Job:
    shop_id: int
    workspace_id: int
    user_id: int
    session_id: int | None
    items: list[Item]
    shared: str  # tüm ürünler için ortak bilgi (fiyat, stok, varyasyon…): kullanıcının sözü
    lang: str
    review: bool  # false: "sormadan yap" (ön kontrol atlanır)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "analyzing"  # analyzing → review → running → done | stopped
    state: dict[int, str] = field(default_factory=dict)  # ürün sırası -> queued | running | done | failed | skipped (oluşturma)
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


def create_job(db, shop: Shop, user_id: int, session_id: int | None, items: list, shared: str, review: bool = True) -> tuple[Job | None, str | None]:
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
        for jid in [k for k, j in _JOBS.items() if now - j.created > JOB_TTL_SECONDS and j.status not in ACTIVE]:
            del _JOBS[jid]
        job = Job(shop.id, shop.workspace_id, user_id, session_id, out, " ".join(str(shared or "").split())[:800], get_lang(), review)
        job.state = {i.index: "queued" for i in out}
        _JOBS[job.id] = job
    return job, None


def start(job: Job) -> bool:
    """Çözümlemeyi arka planda başlatır; ikinci çağrı etkisizdir."""
    with _lock:
        if job.started:
            return False
        job.started = True
    threading.Thread(target=contextvars.copy_context().run, args=(_run_analysis, job), daemon=True).start()
    return True


def confirm(job: Job, edits: list | None = None) -> bool:
    """Ön kontrol onaylandı (kullanıcının düzeltmeleri uygulanır): oluşturma başlar. Yalnızca ön kontrol bekleyen işte çalışır."""
    with _lock:
        if job.status != "review":
            return False
        _apply_edits(job, edits or [])
        job.status = "running"
    threading.Thread(target=contextvars.copy_context().run, args=(_run_all, job), daemon=True).start()
    return True


def stop(job: Job) -> None:
    """Başlamamış ürünler atlanır; çalışanlar biter (yarım taslak bırakılmaz). Ön kontrol aşamasında iş hemen kapanır."""
    job.stop_requested = True
    with _lock:
        if job.status == "review":
            for i in job.items:
                job.state[i.index] = "skipped"
            job.status = "stopped"


# ------------------------------------------------------------------ 1) çözümleme

def _run_analysis(job: Job) -> None:
    with ThreadPoolExecutor(max_workers=ANALYSIS_WORKERS) as pool:
        for fut in [pool.submit(contextvars.copy_context().run, _analyze, job, item) for item in job.items]:
            fut.result()
    if job.stop_requested:
        job.status = "stopped"
        for i in job.items:
            job.state[i.index] = "skipped"
    elif job.review:
        job.status = "review"
    else:
        job.status = "running"
        _run_all(job)


def _analyze(job: Job, item: Item) -> None:
    try:
        item.spec = _analyze_item(job, item)
    except Exception as exc:  # noqa: BLE001 - çözümlenemeyen ürün boş formla kalır; kullanıcı doldurur ya da model oluşturma adımında kendi çıkarır
        log.exception("Toplu listing: çözümleme, ürün %s", item.index)
        item.spec = _empty_spec(str(exc)[:160])
    item.analyzed = True


def _empty_spec(error: str = "") -> dict:
    return {
        "name": "", "phrase": "", "digital": False, "size": "", "material": "", "personalizable": False, "personalization_detail": "", "weight": None, "weight_unit": "oz",
        "weight_estimated": False, "unsure": [], "category_id": None, "categories": [], "error": error,
    }


def _text_field(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _spec_from_report(got: dict) -> dict:
    spec = _empty_spec()
    spec.update(
        name=_text_field(got.get("name"), 120), phrase=_text_field(got.get("phrase"), 80), digital=bool(got.get("digital")), size=_text_field(got.get("size"), 80),
        material=_text_field(got.get("material"), 80), personalizable=bool(got.get("personalizable")), personalization_detail=_text_field(got.get("personalization_detail"), 200),
        unsure=[u for u in (got.get("unsure") or []) if u in ("size", "material", "personalization_detail")],
    )
    try:
        weight = float(got.get("weight_value"))
    except (TypeError, ValueError):
        weight = 0.0
    if weight > 0:
        spec.update(weight=round(weight, 2), weight_unit=got.get("weight_unit") if got.get("weight_unit") in WEIGHT_UNITS else "oz", weight_estimated=True)
    return spec


def _categories(shop_id: int, phrase: str) -> list[dict]:
    """Rakiplerin kategori dağılımı (etsy_top; yalnızca kimlik ve oran): [{taxonomy_id, path, share}]. Etsy hakkı dolduysa ya da hata olursa boş."""
    from app.assistant import tools
    from app.research import etsy_top

    if not phrase:
        return []
    try:
        data = etsy_top.fetch(shop_id, phrase) or {}
        names = tools._taxonomy()
    except Exception:  # noqa: BLE001 - kategori önerisi yardımcıdır; alınamazsa oluşturma adımı kendi seçer
        log.warning("Toplu listing: kategori dağılımı alınamadı (%s)", phrase, exc_info=True)
        return []
    return [{"taxonomy_id": c["taxonomy_id"], "path": names.get(c["taxonomy_id"], ""), "share": c["share"]} for c in data.get("categories") or [] if c["taxonomy_id"] in names]


def _analyze_item(job: Job, item: Item) -> dict:
    """Tek ürünün çözümlemesi: resimlere bakar, `report_product` ile yapılandırılmış cevap alır, kategoriyi rakiplerden önerir."""
    from app.assistant import service

    db = SessionLocal()
    try:
        shop = db.get(Shop, job.shop_id)
        images = [img for iid in item.image_ids if (img := service.get_image(db, shop, iid)) is not None and img.path]
        if shop is None or not images:
            return _empty_spec(tr("Resimler bulunamadı (süresi dolmuş olabilir).", "The images were not found (they may have expired)."))
        got: dict = {}

        def execute(name: str, args: dict) -> dict:
            if name != "report_product":
                return {"error": "Yalnızca report_product kullanılabilir."}
            got.update(args)
            return {"ok": True}

        text = "\n".join(filter(None, [
            f"Ürün {item.index}/{len(job.items)}; {len(item.image_ids)} resim (en çok {service.MODEL_IMAGES_PER_MESSAGE} tanesini görüyorsun).",
            f"Kullanıcının bu ürün için söyledikleri: {item.note}" if item.note else "",
            f"Tüm ürünler için ortak sözler: {job.shared}" if job.shared else "",
        ]))
        model = llm.assistant_model()
        seen = [{"path": i.path, "content_type": i.content_type} for i in images][: service.MODEL_IMAGES_PER_MESSAGE]
        with metering.bind(metering.Scope(job.workspace_id, job.user_id)):
            result = llm.run_agent(model, _ANALYSIS_RULES, f'Mağaza: "{shop.shop_name}".', [], text, seen, [REPORT_TOOL], execute)
            if job.session_id is not None:
                service._record_usage(db, shop.id, job.user_id, job.session_id, result.usage)
            metering.record("assistant", model, result.usage.input_tokens, result.usage.output_tokens)
        db.commit()
        if not got:
            return _empty_spec(tr("Ürün çözümlenemedi.", "The product could not be analysed."))
        spec = _spec_from_report(got)
        spec["categories"] = _categories(job.shop_id, spec["phrase"])
        top = spec["categories"][0] if spec["categories"] else None
        if top and top["share"] >= MIN_CATEGORY_SHARE:
            spec["category_id"] = top["taxonomy_id"]
        return spec
    finally:
        db.close()


def _apply_edits(job: Job, edits: list) -> None:
    """Ön kontrolde kullanıcının düzeltmeleri: yalnızca bilinen alanlar, uzunluk ve tür sınırlarıyla."""
    from app.assistant import tools

    by_index = {i.index: i for i in job.items}
    leaves = set(tools._taxonomy_leaves) if tools._taxonomy_cache is not None else None
    for raw in edits if isinstance(edits, list) else []:
        item = by_index.get(raw.get("index")) if isinstance(raw, dict) else None
        if item is None:
            continue
        spec = item.spec or _empty_spec()
        for key, limit in (("name", 120), ("size", 80), ("material", 80), ("personalization_detail", 200)):
            if key in raw:
                spec[key] = _text_field(raw[key], limit)
        for key in ("digital", "personalizable"):
            if key in raw:
                spec[key] = bool(raw[key])
        if "weight_unit" in raw and raw["weight_unit"] in WEIGHT_UNITS:
            spec["weight_unit"] = raw["weight_unit"]
        if "weight" in raw:
            try:
                weight = float(raw["weight"]) if raw["weight"] not in (None, "") else None
            except (TypeError, ValueError):
                weight = None
            weight = weight if weight and weight > 0 else None
            if weight != spec.get("weight"):
                spec["weight_estimated"] = False  # kullanıcı kendi değerini yazdı
            spec["weight"] = weight
        if "category_id" in raw:
            cid = raw["category_id"]
            options = {c["taxonomy_id"] for c in spec.get("categories", [])}
            if cid in (None, ""):
                spec["category_id"] = None
            elif isinstance(cid, int) and (cid in options or (leaves is not None and cid in leaves)):
                spec["category_id"] = cid
        item.spec = spec


# ------------------------------------------------------------------ 2) oluşturma

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
    """Tek ürün: kendi veritabanı oturumu ve bağlamıyla asistanın listing akışını koşar; sonuç: {ok, listing_id, title, missing, warnings, estimated, error}."""
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
        estimated = _apply_confirmed(ctx, drafted["listing_id"], item.spec, execute)
        missing = list(drafted.get("yayin_icin_eksikler") or [])
        if drafted.get("dijital_dosya_eksik"):
            missing.append(tr("Dijital ürün: indirilebilir dosya eksik.", "Digital product: the downloadable file is missing."))
        return {
            "ok": True, "listing_id": drafted["listing_id"], "title": drafted.get("_title", ""), "missing": [str(m) for m in missing],
            "warnings": [str(w) for w in drafted.get("kalite_uyarilari") or []], "estimated": estimated,
        }
    finally:
        db.close()


def _apply_confirmed(ctx, listing_id: int, spec: dict, execute) -> list[str]:
    """Onaylanan bilgilerden modelin yazmadığı olan KESİN uygulanır (kategori, ağırlık); tahmini olanlar döner ("Kontrol et" listesi için)."""
    from app.assistant import tools

    estimated: list[str] = []
    work = tools._draft_work(ctx, listing_id) or {}
    category = spec.get("category_id")
    if category and work.get("taxonomy_id") != category:
        if not execute("set_listing_fields", {"listing_id": listing_id, "taxonomy_id": category}).get("error"):
            execute("autofill_listing_attributes", {"listing_id": listing_id})  # kategori değişti: o kategorinin özellikleri yeniden doldurulur
    if spec.get("weight"):
        if not execute("set_listing_fields", {"listing_id": listing_id, "weight": spec["weight"], "weight_unit": spec.get("weight_unit") or "oz"}).get("error") and spec.get("weight_estimated"):
            estimated.append("weight")
    return estimated


def _facts(spec: dict) -> str:
    """Onaylı bilgiler, alt çalıştırmaya olgu olarak verilir (boş olan bilinmiyor demektir: yazma)."""
    if not spec:
        return ""
    lines = [f"ürün: {spec.get('name') or '(resimden çıkar)'}", f"tür: {'DİJİTAL (listing_type=download)' if spec.get('digital') else 'fiziksel'}"]
    lines.append(f"ölçü/kapasite: {spec['size']}" if spec.get("size") else "ölçü/kapasite: BİLİNMİYOR (başlığa ve açıklamaya ölçü/kapasite yazma)")
    lines.append(f"malzeme: {spec['material']}" if spec.get("material") else "malzeme: bilinmiyor (resimde açıkça görünmüyorsa yazma)")
    if spec.get("personalizable"):
        detail = spec.get("personalization_detail")
        lines.append(f"kişiselleştirme: VAR (personalizable=true){' — ' + detail if detail else ' — türü bilinmiyor (gravür/nakış/karakter sınırı uydurma; yalnızca isim/metin girişi olduğunu söyle)'}")
    else:
        lines.append("kişiselleştirme: YOK")
    if spec.get("category_id"):
        lines.append(f"kategori: taxonomy_id={spec['category_id']} (create_listing_draft'a bu taxonomy_id'yi ver; find_category ile başka kategori arama)")
    return "Kullanıcının onayladığı bilgiler (DOĞRU kabul et; boş olanı uydurma):\n- " + "\n- ".join(lines)


def _text(job: Job, item: Item, siblings: list[str], retry: bool) -> str:
    parts = [_CREATE_NOTE.format(n=item.index, total=len(job.items))]
    parts.append(f"Bu ürünün resim kimlikleri: {', '.join(item.image_ids)}")
    if item.note:
        parts.append(f"Kullanıcının bu ürün için söyledikleri: {item.note}")
    if job.shared:
        parts.append(f"Tüm ürünler için ortak bilgiler (fiyat, stok, varyasyon…): {job.shared}")
    facts = _facts(item.spec)
    if facts:
        parts.append(facts)
    if siblings:
        parts.append("Aynı toplu işte hazırlanan diğer ürünlerin başlıkları (kopyalama; farklı uzun kuyruklu ifadeleri hedefle): " + " | ".join(siblings[-14:]))
    if retry:
        parts.append("ÖNCEKİ DENEMEDE TASLAK KURULMADI: araç hatalarını kendin düzelt ve create_listing_draft'ı ŞİMDİ çağır; soru sorma, yazıyla cevap verme.")
    return "\n".join(parts)


def public(job: Job) -> dict:
    """Arayüzün sorguladığı durum: ürün başına çözümleme (düzenlenebilir ön kontrol), oluşturma durumu ve sonuç, toplamlar."""
    rows = []
    for item in job.items:
        r = job.results.get(item.index, {})
        rows.append({
            "index": item.index, "images": len(item.image_ids), "image_id": item.image_ids[0], "analyzed": item.analyzed, "spec": item.spec, "state": job.state.get(item.index, "queued"),
            "listing_id": r.get("listing_id"), "title": r.get("title", ""), "missing": r.get("missing", []), "warnings": r.get("warnings", []), "estimated": r.get("estimated", []),
            "error": r.get("error", ""),
        })
    states = list(job.state.values())
    return {
        "job_id": job.id, "status": job.status, "review": job.review, "total": len(job.items), "analyzed": sum(1 for i in job.items if i.analyzed), "done": states.count("done"),
        "failed": states.count("failed"), "skipped": states.count("skipped"), "running": states.count("running"), "items": rows,
        "listing_ids": [r["listing_id"] for r in rows if r["listing_id"]],
    }

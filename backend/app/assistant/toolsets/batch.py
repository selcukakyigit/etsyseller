"""Toplu yeni listing (birden çok ürünün resminden her biri için AYRI taslak). Asıl iş assistant/batch_drafts.py'dedir; burası asistan argümanlarını ona çevirir ve kartı üretir.

Akış: create_listings_from_images → ürünler çözümlenir (kartta ilerleme) → ÖN KONTROL: kullanıcı kartta ürün bilgilerini (ad, ölçü/kapasite, malzeme, kişiselleştirme, ağırlık, kategori)
gözden geçirip "Taslakları oluştur"a basar (ya da sohbette onaylarsa start_batch_listings; baştan "sormadan yap" derse skip_review) → ürün başına taslak oluşturulur.
Etsy'ye hiçbir şey gitmez, resim/video üretilmez (kredi harcanmaz)."""
from app.assistant import batch_drafts
from app.assistant.toolsets import links
from app.core.i18n import tr


def _job(ctx, a: dict):
    return batch_drafts.get(str(a.get("job_id") or ""), ctx.shop.id)


def create_listings_from_images(ctx, a: dict) -> dict:
    skip = bool(a.get("skip_review"))
    job, error = batch_drafts.create_job(ctx.db, ctx.shop, ctx.user_id, ctx.session_id, a.get("items") or [], str(a.get("shared") or ""), review=not skip, user_texts=links._user_texts(ctx))
    if error:
        return {"error": error}
    batch_drafts.start(job)
    state = batch_drafts.public(job)
    ctx.cards.append({"type": "batch_job", **state})
    return {
        "job_id": job.id, "baslatildi": True, "urun_sayisi": state["total"], "on_kontrol_atlandi": skip,
        "not": tr(
            ("Ürünler arka planda çözümleniyor; bittiğinde kartta her ürünün bilgileri (ad, ölçü/kapasite, malzeme, kişiselleştirme, ağırlık, kategori) düzenlenebilir görünür ve kullanıcı 'Taslakları oluştur'a basar "
             "(sohbette onaylarsa start_batch_listings'i bu job_id ile çağır). Kullanıcıya TEK ya da iki cümleyle söyle: kaç ürün çözümleniyor, kartı gözden geçirmesi gerektiği ve fiyatı söylenmeyenlerin 'Fiyat gir' eksiğiyle kurulacağı. "
             "Hiçbiri Etsy'ye gitmez. ask_user ÇAĞIRMA, öneri/seçenek kartı SUNMA, 'hazır' deme; bitmesini bekleme."
             if not skip else
             "Kullanıcı sormadan yap dedi: ürünler çözümlenip hemen taslağa çevriliyor, tahmin edilen değerler (ağırlık, kategori) sonda 'tahmini' diye işaretli görünür. "
             "Kısaca söyle (kaç ürün, fiyatı söylenmeyenlerin 'Fiyat gir' eksiğiyle kurulacağı, hiçbirinin Etsy'ye gitmediği). ask_user ÇAĞIRMA, öneri kartı SUNMA, 'hazır' deme; bitmesini bekleme."),
            ("The products are being analysed in the background; when done the card shows each product's details (name, size/capacity, material, personalization, weight, category) for editing and the user presses "
             "'Create drafts' (if they confirm in chat, call start_batch_listings with this job_id). Tell the user in one or two sentences: how many products are being analysed, that they should review the card, and that products "
             "without a price will be created with a 'Set a price' gap. Nothing goes to Etsy. Do NOT call ask_user, do NOT show a suggestion card, do NOT say 'ready'; do not wait."
             if not skip else
             "The user said do it without asking: products are analysed and turned into drafts right away; estimated values (weight, category) are marked 'estimated' at the end. "
             "Say so briefly (how many products, those without a price get a 'Set a price' gap, nothing goes to Etsy). Do NOT call ask_user, do NOT show a suggestion card, do NOT say 'ready'; do not wait."),
        ),
    }


def start_batch_listings(ctx, a: dict) -> dict:
    job = _job(ctx, a)
    if job is None:
        return {"error": "İş bulunamadı (süresi dolmuş olabilir)."}
    if not batch_drafts.confirm(job):
        return {"not": tr(
            f"İş şu an '{job.status}' durumunda; ön kontrol beklemiyor (çözümleme sürüyorsa bitmesini bekle, kullanıcıya söyle).",
            f"The job is '{job.status}' right now and is not waiting for review (if analysis is still running, say so and wait).",
        )}
    return {"basladi": True, "not": tr(
        "Ürünler için taslaklar arka planda oluşturuluyor; kartta ürün ürün ilerleme var. Kısaca söyle, bitmesini bekleme, öneri kartı sunma.",
        "Drafts are being created in the background; the card shows progress per product. Say so briefly, do not wait, do not show a suggestion card.",
    )}


def batch_listings_status(ctx, a: dict) -> dict:
    job = _job(ctx, a)
    if job is None:
        return {"error": "İş bulunamadı (süresi dolmuş olabilir)."}
    state = batch_drafts.public(job)
    return {
        "durum": state["status"], "toplam": state["total"], "cozumlenen": state["analyzed"], "hazir": state["done"], "olmayan": state["failed"], "atlanan": state["skipped"], "suruyor": state["running"],
        "urunler": [
            {"sira": i["index"], "durum": i["state"], "ad": (i["spec"] or {}).get("name", ""), "baslik": i["title"], "listing_id": i["listing_id"], "eksikler": i["missing"], "hata": i["error"], "tahmini": i["estimated"]}
            for i in state["items"]
        ],
        "not": tr(
            "durum review ise kullanıcı kartı gözden geçirip 'Taslakları oluştur'a basmayı bekliyor; analyzing/running ise sürüyor (bitmedi de, bitti deme). Yalnızca durum done/stopped olunca özetle: kaç taslak hazır, hangilerinde eksik var (fiyat vb.).",
            "status review means the user is to review the card and press 'Create drafts'; analyzing/running means it is still going (do not say it is done). Summarise only when the status is done/stopped.",
        ),
    }


def stop_batch_listings(ctx, a: dict) -> dict:
    job = _job(ctx, a)
    if job is None:
        return {"error": "İş bulunamadı (süresi dolmuş olabilir)."}
    batch_drafts.stop(job)
    return {"durduruldu": True, "not": tr("Başlamamış ürünler atlanır; çalışanlar biter ve o ana dek oluşan taslaklar yerelde kalır.", "Products not started are skipped; running ones finish and the drafts made so far stay local.")}


_JOB = {"job_id": {"type": "string", "description": "create_listings_from_images sonucundaki job_id"}}
TOOLS: list[dict] = [
    {
        "name": "create_listings_from_images",
        "description": "Birden çok ÜRÜNÜN resminden HER BİRİ İÇİN AYRI yerel listing taslağı hazırlar (en fazla 15 ürün; ürün başına en fazla 20 resim). YALNIZCA kullanıcı farklı ürünlerin resimlerini verip "
        "her biri ayrı listing olsun dediğinde kullan; aynı ürünün farklı açıları TEK listing'dir (create_listing_draft). Ürünleri sen gruplarsın: her ürünün TÜM resim kimliklerini image_ids'e ver "
        "(sistem bağlamındaki resim listesinden). Ürünün adını/türünü/kategorisini sunucu resimden ve rakiplerden çıkarır, kullanıcı kartta gözden geçirip onaylar; kullanıcı söylediyse note'a yaz "
        "(ad, tür dijital/fiziksel, fiyat, kapasite…). Dijital ürünün (printable, şablon…) indirilebilir dosyalarını file_ids'e ver (dosyası olan ürün dijital sayılır). Ortak bilgiyi (hepsi için fiyat, stok, varyasyon, kişiselleştirme ve istisnaları) shared'a, kullanıcının sözüne yakın yaz. Kullanıcı 'sormadan yap' "
        "dediyse skip_review=true. Arka planda çalışır, sohbette kart çıkar; Etsy'ye gitmez, resim/video üretmez. Fiyat söylenmediyse SORMA: taslaklar 'Fiyat gir' eksiğiyle kurulur.",
        "input_schema": {"type": "object", "properties": {
            "items": {"type": "array", "maxItems": 15, "description": "Her eleman bir ÜRÜN (bir listing)", "items": {"type": "object", "properties": {
                "image_ids": {"type": "array", "items": {"type": "string"}, "description": "Bu ürünün TÜM resimlerinin kimlikleri (çekim sırasıyla)"},
                "note": {"type": "string", "description": "Kullanıcının bu ürün için söyledikleri: ad, tür (dijital/fiziksel), fiyat, ölçü, kapasite… yoksa boş"},
                "file_ids": {"type": "array", "maxItems": 5, "items": {"type": "string"}, "description": "DİJİTAL ürünün indirilebilir dosyalarının kimlikleri (PDF, ZIP, PNG…; sistem bağlamındaki 'belgeler' listesinden; en fazla 5). Dosyayı ürünle dosya adından ve kullanıcının sözünden eşleştir; emin değilsen önce ask_user ile sor. Resimler (önizleme/mockup) image_ids'e gider. Fiziksel ürünse boş"},
                "links": {"type": "array", "maxItems": 3, "description": "Kullanıcının BU ürün için YAZDIĞI adresler (ürün sayfası, benzer listing); kendin adres uydurma. Sunucu okur ve ön kontrole yansıtır", "items": {"type": "object", "properties": {
                    "url": {"type": "string"},
                    "purpose": {"type": "string", "enum": ["product_info", "reference_listing", "competitor"], "description": "product_info = ürünün kendi sayfası (ölçü/malzeme olgusu alınır); reference_listing = 'benzer, referans al' (kopyalama yok); competitor = rakip"},
                }, "required": ["url"]}},
            }, "required": ["image_ids"]}},
            "shared": {"type": "string", "description": "Tüm ürünler için ortak bilgi (kullanıcının sözüne yakın): ör. 'hepsi 20 adet, termos 20 $, duvar dekoru 150 $, duvar dekoru hariç kişiselleştirme var'; yoksa boş"},
            "skip_review": {"type": "boolean", "description": "Kullanıcı 'sormadan yap / kontrol etmeden oluştur' dediyse true: ön kontrol kartı atlanır"},
        }, "required": ["items"]},
    },
    {"name": "start_batch_listings", "description": "Ön kontrolü onaylanan toplu listing işinin taslak oluşturmasını başlatır (kullanıcı kartı sohbette onayladıysa; karttaki 'Taslakları oluştur' ile aynı).", "input_schema": {"type": "object", "properties": _JOB, "required": ["job_id"]}},
    {"name": "batch_listings_status", "description": "Toplu listing işinin durumu: çözümleme/ön kontrol/oluşturma, ürün ürün sonuç ve eksikler. Kullanıcı 'hazır mı / ne durumda / incele' derse ÖNCE bunu çağır; bitmeden hazır deme.", "input_schema": {"type": "object", "properties": _JOB, "required": ["job_id"]}},
    {"name": "stop_batch_listings", "description": "Toplu listing işini durdurur (başlamamış ürünler atlanır; oluşan taslaklar kalır).", "input_schema": {"type": "object", "properties": _JOB, "required": ["job_id"]}},
]
EXECUTORS = {
    "create_listings_from_images": create_listings_from_images, "start_batch_listings": start_batch_listings, "batch_listings_status": batch_listings_status, "stop_batch_listings": stop_batch_listings,
}
LABELS = {
    "create_listings_from_images": "Ürünleri çözümlüyor", "start_batch_listings": "Taslakları oluşturmayı başlatıyor", "batch_listings_status": "İşin durumuna bakıyor", "stop_batch_listings": "Toplu taslak işini durduruyor",
}
LABELS_EN = {
    "create_listings_from_images": "Analysing the products", "start_batch_listings": "Starting to create the drafts", "batch_listings_status": "Checking the job status", "stop_batch_listings": "Stopping the batch draft job",
}

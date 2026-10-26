"""Toplu yeni listing (birden çok ürünün resminden her biri için AYRI taslak). Asıl iş assistant/batch_drafts.py'dedir; burası asistan argümanlarını ona çevirir ve kartı üretir.

Akış: create_listings_from_images → iş arka planda başlar (ürün başına ayrı alt çalıştırma, aynı tek listing akışı) → sohbette tek ilerleme kartı → bitince taslakların özeti.
Etsy'ye hiçbir şey gitmez, resim/video üretilmez (kredi harcanmaz)."""
from app.assistant import batch_drafts
from app.core.i18n import tr


def create_listings_from_images(ctx, a: dict) -> dict:
    job, error = batch_drafts.create_job(ctx.db, ctx.shop, ctx.user_id, ctx.session_id, a.get("items") or [], str(a.get("shared") or ""))
    if error:
        return {"error": error}
    batch_drafts.start(job)
    state = batch_drafts.public(job)
    ctx.cards.append({"type": "batch_job", **state})
    return {
        "job_id": job.id, "baslatildi": True, "urun_sayisi": state["total"],
        "not": tr(
            "İş arka planda çalışıyor; kartta ürün ürün ilerleme ve durdur düğmesi var, bitince her taslağa bağlantı çıkar. Kullanıcıya kısaca söyle: kaç ürün için taslak hazırlanıyor, "
            "fiyatı söylenmeyenlerin 'Fiyat gir' eksiğiyle kurulacağı, hiçbirinin Etsy'ye gitmediği (yayın ayrı ve onaylı) ve başka işe devam edebileceği. Bitmesini bekleme, aracı tekrar çağırma.",
            "The job runs in the background; the card shows progress per product with a stop button and links to each draft when done. Tell the user briefly: how many products are being drafted, "
            "that those without a price will be created with a 'Set a price' gap, that nothing goes to Etsy (publishing is separate and confirmed) and that they can keep working. Do not wait or call the tool again.",
        ),
    }


def stop_batch_listings(ctx, a: dict) -> dict:
    job = batch_drafts.get(str(a.get("job_id") or ""), ctx.shop.id)
    if job is None:
        return {"error": "İş bulunamadı (süresi dolmuş olabilir)."}
    batch_drafts.stop(job)
    return {"durduruldu": True, "not": tr("Başlamamış ürünler atlanır; çalışanlar biter ve o ana dek oluşan taslaklar yerelde kalır.", "Products not started are skipped; running ones finish and the drafts made so far stay local.")}


TOOLS: list[dict] = [
    {
        "name": "create_listings_from_images",
        "description": "Birden çok ÜRÜNÜN resminden HER BİRİ İÇİN AYRI yerel listing taslağı oluşturur (en fazla 15 ürün; ürün başına en fazla 20 resim). YALNIZCA kullanıcı farklı ürünlerin resimlerini verip "
        "her biri ayrı listing olsun dediğinde kullan; aynı ürünün farklı açıları TEK listing'dir (create_listing_draft). Ürünleri sen gruplarsın: her ürünün TÜM resim kimliklerini image_ids'e ver "
        "(sistem bağlamındaki resim listesinden). Ürünün adını/türünü/malzemesini sunucu resimden çıkarır; kullanıcı söylediyse note'a yaz (ad, tür dijital/fiziksel, fiyat…). Ortak bilgiyi "
        "(hepsi için fiyat, stok, varyasyon, kişiselleştirme) shared'a yaz. Arka planda çalışır, sohbette ilerleme kartı çıkar; Etsy'ye gitmez, resim/video üretmez. Fiyat söylenmediyse SORMA: taslaklar 'Fiyat gir' eksiğiyle kurulur.",
        "input_schema": {"type": "object", "properties": {
            "items": {"type": "array", "maxItems": 15, "description": "Her eleman bir ÜRÜN (bir listing)", "items": {"type": "object", "properties": {
                "image_ids": {"type": "array", "items": {"type": "string"}, "description": "Bu ürünün TÜM resimlerinin kimlikleri (çekim sırasıyla)"},
                "note": {"type": "string", "description": "Kullanıcının bu ürün için söyledikleri: ad, tür (dijital/fiziksel), fiyat, ölçü, renk… yoksa boş"},
            }, "required": ["image_ids"]}},
            "shared": {"type": "string", "description": "Tüm ürünler için ortak bilgi (kullanıcının sözüne yakın): ör. 'hepsi 49 $, stok 20, her birinde 3 renk'; yoksa boş"},
        }, "required": ["items"]},
    },
    {"name": "stop_batch_listings", "description": "Çalışan toplu listing oluşturmayı durdurur (başlamamış ürünler atlanır; oluşan taslaklar kalır).", "input_schema": {"type": "object", "properties": {"job_id": {"type": "string", "description": "create_listings_from_images sonucundaki job_id"}}, "required": ["job_id"]}},
]
EXECUTORS = {"create_listings_from_images": create_listings_from_images, "stop_batch_listings": stop_batch_listings}
LABELS = {"create_listings_from_images": "Ürünlerden taslakları başlatıyor", "stop_batch_listings": "Toplu taslak işini durduruyor"}
LABELS_EN = {"create_listings_from_images": "Starting drafts for the products", "stop_batch_listings": "Stopping the batch draft job"}

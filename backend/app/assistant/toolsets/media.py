"""Çoklu medya üretimi (ek resimler + ürün videosu) araçları. Asıl iş assistant/media_jobs.py'dedir; burası asistan argümanlarını ona çevirir ve MALİYET KARTINI üretir.

Akış: plan_listing_media → maliyet kartı ([Üret] [Vazgeç]); araç HİÇBİR ŞEY ÜRETMEZ ve kredi harcamaz. Üretimi kullanıcının karttaki [Üret] düğmesi başlatır (model başlatamaz);
ilerleme aynı kartta, sonuç yerel taslağa eklenir (Etsy'ye gitmez)."""
from app.assistant import media_jobs
from app.core.i18n import tr
from app.listings import inventory_edit


def plan_listing_media(ctx, a: dict) -> dict:
    from app.assistant import tools

    raw = a.get("listing_ids") or ([a["listing_id"]] if a.get("listing_id") is not None else [])
    try:
        ids = list(dict.fromkeys(int(i) for i in raw))
    except (TypeError, ValueError):
        return {"error": "listing_ids sayı listesi olmalı."}
    if not ids:
        return {"error": "Listing belirtilmedi (listing_id ya da listing_ids; toplu işin taslakları için batch_listings_status'taki listing_id'ler)."}
    if len(ids) > media_jobs.MAX_LISTINGS:
        return {"error": f"Bir seferde en fazla {media_jobs.MAX_LISTINGS} listing için medya üretilir ({len(ids)} verildi)."}
    items, unknown = [], []
    variation = str(a.get("variation_name") or "").strip()
    for lid in ids:
        work, err = tools._work_or_error(ctx, lid)
        if err:
            unknown.append(lid)
            continue
        options: list[str] = []
        if variation:
            names = inventory_edit.variation_names(work)
            real = next((n for n in names if n.lower() == variation.lower()), None)
            if real is None:
                return {"error": f"Listing {lid}'de '{variation}' varyasyonu yok (var olanlar: {', '.join(names) or 'hiçbiri'}). Önce varyasyonu kur."}
            variation = real
            options = inventory_edit.options(work, real)
        items.append({"listing_id": lid, "title": str((work or {}).get("title") or ""), "images": len(work.get("images") or []), "videos": len(work.get("videos") or []), "options": options})
    if not items:
        return {"error": "Listing bulunamadı."}
    seconds = int(a.get("video_seconds") or media_jobs.VIDEO_SECONDS[0])
    job, error = media_jobs.plan(ctx.db, ctx.shop, ctx.user_id, ctx.session_id, items, 0 if variation else int(a.get("images_per_listing") or 0), bool(a.get("video")), seconds, str(a.get("instruction") or ""), variation)
    if error:
        return {"error": error}
    state = media_jobs.public(job)
    ctx.cards.append({"type": "media_job", **state})
    q = state["quote"]
    return {
        "job_id": job.id, "onay_bekliyor": True, "resim": q["images"], "video": q["videos"], "kredi": q["credits"], **({"bulunamayan": unknown} if unknown else {}),
        "bakiye_yeterli": q["affordable"], "kredi_sistemi_acik": q["credits_enabled"],
        "not": tr(
            "Sohbette MALİYET KARTI gösterildi (resim/video sayısı ve kredi). Kullanıcı kartta [Üret]'e basmadan HİÇBİR ŞEY ÜRETİLMEZ ve kredi harcanmaz: 'üretiyorum/ekledim' DEME. "
            "Tek cümleyle söyle: kaç resim ve video için ne kadar kredi tuttuğunu (kredi sistemi kapalıysa ücretsiz olduğunu) ve onay için karttaki düğmeyi. ask_user ile öneri kartı SUNMA, aracı tekrar çağırma. "
            "bakiye_yeterli=false ise bakiyenin yetmediğini de söyle.",
            "A COST CARD was shown (image/video counts and credits). NOTHING is generated and no credits are spent until the user presses [Generate] on the card: do NOT say 'generating/added'. "
            "Say in one sentence how many images and videos it covers and the credit cost (free if the credit system is off), and that the card button confirms. Do NOT call ask_user with suggestions or call the tool again. "
            "If bakiye_yeterli is false, say the balance is not enough.",
        ),
    }


def media_job_status(ctx, a: dict) -> dict:
    job = media_jobs.get(str(a.get("job_id") or ""), ctx.shop.id)
    if job is None:
        return {"error": "İş bulunamadı (süresi dolmuş olabilir)."}
    s = media_jobs.public(job)
    return {
        "durum": s["status"], "uretilen_resim": s["images_total"], "uretilen_video": s["videos_total"], "tamam": s["done"], "olmayan": s["failed"], "suruyor": s["running"], "is_notu": s["note"],
        "listingler": [{"listing_id": i["listing_id"], "durum": i["state"], "resim": i["images_done"], "video": i["video_done"], "hatalar": i["errors"]} for i in s["items"]],
        "not": tr("durum quote ise kullanıcı kartta [Üret]'e basmayı bekliyor; running ise sürüyor (bitti deme). Yalnızca done/stopped olunca özetle.", "status quote means the user has yet to press [Generate]; running means it is still going (do not say it is done). Summarise only when done/stopped."),
    }


def stop_media_job(ctx, a: dict) -> dict:
    job = media_jobs.get(str(a.get("job_id") or ""), ctx.shop.id)
    if job is None:
        return {"error": "İş bulunamadı (süresi dolmuş olabilir)."}
    media_jobs.stop(job)
    return {"durduruldu": True, "not": tr("Başlamamış listing'ler atlanır; üretilenler taslakta kalır.", "Listings not started are skipped; what was generated stays in the drafts.")}


_JOB = {"job_id": {"type": "string", "description": "plan_listing_media sonucundaki job_id"}}
TOOLS: list[dict] = [
    {
        "name": "plan_listing_media",
        "description": "Bir ya da birden çok listing/taslak için EK RESİM ve/veya ürün VİDEOSU üretimini PLANLAR ve MALİYET KARTI gösterir; kendisi hiçbir şey üretmez, kredi harcamaz. Kullanıcı 'şu listing için 10 resim ve bir tanıtım videosu üret', "
        "'bütün taslaklara 5'er resim ekle', 'video üret' gibi ÇOKLU üretim isterse kullan (tek bir resim istenirse edit_chat_image). Üretim yalnızca kullanıcı karttaki [Üret]'e basınca başlar. Resimler listing'in ilk fotoğrafından, her biri "
        "farklı bir çekim olarak üretilir (ürün değişmez); video ilk fotoğraftan. Sonuç yerel taslağa eklenir, Etsy'ye gitmez. En çok 15 listing, listing başına en çok 10 resim ve 1 video. 'Her renk için bir resim üret ve renge bağla' gibi istekte de BUNU kullan (variation_name='Color'); ayrı edit_chat_image/set_variation_photo çağrıları yapma.",
        "input_schema": {"type": "object", "properties": {
            "listing_ids": {"type": "array", "items": {"type": "integer"}, "maxItems": 15, "description": "Taslak/listing kimlikleri (toplu işin taslakları için batch_listings_status'taki listing_id'ler)"},
            "listing_id": {"type": "integer", "description": "Tek listing için kısayol"},
            "images_per_listing": {"type": "integer", "description": "Listing başına üretilecek ek resim sayısı (0-10)"},
            "video": {"type": "boolean", "description": "Her listing için bir ürün videosu üretilsin mi (kullanıcı istediyse true)"},
            "video_seconds": {"type": "integer", "enum": list(media_jobs.VIDEO_SECONDS), "description": "Video süresi (varsayılan 5)"},
            "variation_name": {"type": "string", "description": "SEÇENEK MODU ('her renk için bir resim üret ve renge bağla'): varyasyonun adı (ör. Color). Verilirse bu varyasyonun HER seçeneği için bir görsel üretilir (ürün aynı, yalnızca o renk/yüzey) ve otomatik o seçeneğe bağlanır; images_per_listing verme. Etsy fotoğrafı yalnızca TEK varyasyona bağlar"},
            "instruction": {"type": "string", "description": "Kullanıcının resim/video için yönü (ör. 'sıcak oturma odası havası'); yoksa boş"},
        }, "required": []},
    },
    {"name": "media_job_status", "description": "Medya üretim işinin durumu (onay bekliyor, sürüyor, bitti), listing başına üretilen resim/video ve hatalar. Kullanıcı 'bitti mi / ne durumda' derse ÖNCE bunu çağır.", "input_schema": {"type": "object", "properties": _JOB, "required": ["job_id"]}},
    {"name": "stop_media_job", "description": "Çalışan medya üretimini durdurur (başlamamış listing'ler atlanır; üretilenler taslakta kalır).", "input_schema": {"type": "object", "properties": _JOB, "required": ["job_id"]}},
]
EXECUTORS = {"plan_listing_media": plan_listing_media, "media_job_status": media_job_status, "stop_media_job": stop_media_job}
LABELS = {"plan_listing_media": "Maliyeti hesaplıyor", "media_job_status": "Üretimin durumuna bakıyor", "stop_media_job": "Üretimi durduruyor"}
LABELS_EN = {"plan_listing_media": "Working out the cost", "media_job_status": "Checking the generation status", "stop_media_job": "Stopping the generation"}

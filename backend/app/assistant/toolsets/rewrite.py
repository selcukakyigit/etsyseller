"""Toplu yapay zekâ yeniden yazımı (başlık / etiket / açıklama). Asıl iş listings/rewrite.py'dedir; burası asistan argümanlarını ona çevirir ve kartı üretir.

Akış: rewrite_listings → (büyük işte önce tahmini söyler, onay bekler) → 2 örneği yazar, önizleme kartı çıkar → kullanıcı karttaki "Devam et" düğmesine basar
ya da sohbette onaylar (continue_rewrite) → kalanı arka planda sırayla yazılır, ilerleme kartta görünür, sonuç toplu sonuç kartına döner."""
from app.assistant.toolsets.bulk import _filter
from app.billing import credits
from app.core.i18n import tr
from app.listings import rewrite
from app.listings.selection import select_rows


def rewrite_listings(ctx, a: dict) -> dict:
    flt = _filter(a)
    if flt.is_empty() and not a.get("all_listings"):
        return {"error": "Hedef belirtilmedi: listing_ids, title_contains, tag_contains, shop_section_id, taxonomy_id, fiyat aralığı ya da listing_type ver. Kullanıcı tüm listing'leri istiyorsa all_listings=true ver."}
    ids = [r.listing_id for r in select_rows(ctx.db, ctx.shop, flt)]
    if not ids:
        return {"error": "Filtreye uyan listing yok."}
    fields = tuple(f for f in (a.get("fields") or rewrite.FIELDS) if f in rewrite.FIELDS) or rewrite.FIELDS
    est = rewrite.estimate(len(ids))
    if est["needs_confirmation"] and not a.get("confirmed"):
        return {
            "onay_gerekli": est,
            "not": tr(
                "Kullanıcıya tahmini söyle: kaç listing, yaklaşık kaç kredi (listing başına ~3), ilk 2 listing'in önizlemesini göstereceğini ve istersen durdurabileceğini. "
                "Kullanıcı onaylayınca aynı argümanlarla confirmed=true vererek tekrar çağır.",
                "Tell the user the estimate: how many listings, about how many credits (~3 per listing), that you will show a preview of the first 2 and that they can stop at any time. "
                "When they confirm, call again with the same arguments and confirmed=true.",
            ),
        }
    if not credits.can_afford(ctx.shop.workspace_id, rewrite.SAMPLE_COUNT * rewrite.CREDITS_PER_LISTING):
        return {"error": "Kredi yetersiz."}
    job = rewrite.create(ctx.shop, ctx.user_id, ids, fields, str(a.get("instruction") or "")[:400])
    rewrite.run_preview(job)
    state = rewrite.public(job)
    ctx.cards.append({"type": "rewrite_job", **state})
    if not state["samples"]:
        return {"hata": "Örnek yazılamadı", "nedenleri": state["skipped"], "job_id": job.id}
    return {
        "job_id": job.id, "toplam": state["total"], "tahmini_kalan": state["estimate"],
        "ornekler": [{"id": s["id"], "yeni_baslik": s["detail"]["after"]["title"]} for s in state["samples"]],
        "not": tr(
            "İlk örnekler yerel taslak olarak yazıldı ve kartta önce/sonra görünüyor. Kısaca söyle ve kullanıcıya sor: devam edilsin mi? (kartta 'Devam et' düğmesi var; sohbette onaylarsa "
            "continue_rewrite'ı bu job_id ile çağır). Değişiklik isterse (ör. daha sade, farklı odak) aynı filtreyle instruction vererek rewrite_listings'i tekrar çağır. "
            "Çok sayıda listing'i aynı anda değiştirmek etki ölçümünü bulandırır, kısaca hatırlat.",
            "The first samples were written as local drafts and appear in the card as before/after. Say so briefly and ask whether to continue (the card has a 'Continue' button; if they confirm in chat, "
            "call continue_rewrite with this job_id). If they want changes (e.g. plainer, different focus), call rewrite_listings again with the same filter and an instruction. "
            "Changing many listings at once blurs impact measurement; mention it briefly.",
        ),
    }


def _job(ctx, a: dict):
    return rewrite.get(str(a.get("job_id") or ""), ctx.shop.id)


def continue_rewrite(ctx, a: dict) -> dict:
    job = _job(ctx, a)
    if job is None:
        return {"error": "İş bulunamadı (süresi dolmuş olabilir); rewrite_listings'i yeniden çağır."}
    if not rewrite.start(job):
        return {"not": tr("İş zaten başlatılmış.", "The job has already started.")}
    left = len(job.listing_ids) - len(job.results)
    return {"basladi": True, "kalan": left, "not": tr(
        "Arka planda sırayla yazılıyor; ilerleme ve durdur düğmesi kartta. Bitince sonuç kartı çıkar. Kısaca söyle, başka işe devam edebileceğini belirt.",
        "It runs in the background one by one; progress and the stop button are in the card, and a result card appears when done. Say so briefly and mention they can keep working.",
    )}


def stop_rewrite(ctx, a: dict) -> dict:
    job = _job(ctx, a)
    if job is None:
        return {"error": "İş bulunamadı."}
    rewrite.stop(job)
    return {"durduruldu": True, "yazilan": len(job.results)}


_ID = {"type": "string", "description": "rewrite_listings sonucundaki job_id"}
TOOLS: list[dict] = [
    {
        "name": "rewrite_listings",
        "description": "Birçok listing'in başlık/etiket/açıklamasını yapay zekâyla TEK TEK yeniden yazar (ör. 'bütün garage sign başlıklarını yeniden yaz', 'tüm etiketleri SEO'ya göre yenile'). Aynı metni değiştirmek için DEĞİL (bul-değiştir/önek/etiket ekleme için bulk_update_listings). "
        "Önce 2 listing'i yazıp önizleme kartı gösterir; kullanıcı onaylayınca kalanı arka planda yazılır (continue_rewrite). Hepsi yerel taslak olur, Etsy'ye gitmez. Büyük işte (20+ listing ya da ~60+ kredi) önce onay_gerekli döner: tahmini kullanıcıya söyle, onaylayınca confirmed=true ile tekrar çağır. "
        "Hedef filtreleri bulk_update_listings ile aynı. Listing başına ~3 kredi.",
        "input_schema": {"type": "object", "properties": {
            "listing_ids": {"type": "array", "items": {"type": "integer"}}, "title_contains": {"type": "string"}, "tag_contains": {"type": "string"},
            "shop_section_id": {"type": "integer"}, "taxonomy_id": {"type": "integer"}, "min_price": {"type": "number"}, "max_price": {"type": "number"},
            "state": {"type": "string", "enum": ["active", "inactive", "draft", "any"]}, "listing_type": {"type": "string", "enum": ["physical", "download"]},
            "all_listings": {"type": "boolean", "description": "Hedef filtresi olmadan TÜM aktif listing'ler: yalnızca kullanıcı açıkça söylediyse"},
            "fields": {"type": "array", "items": {"type": "string", "enum": ["title", "tags", "description"]}, "description": "Yeniden yazılacak alanlar; verilmezse üçü de"},
            "instruction": {"type": "string", "description": "Kullanıcının ton/odak isteği (ör. 'daha sade', 'hediye odaklı'); yoksa boş bırak"},
            "confirmed": {"type": "boolean", "description": "Kullanıcı tahmini görüp onayladıysa true"},
        }, "required": []},
    },
    {"name": "continue_rewrite", "description": "Önizlemesi onaylanan toplu yeniden yazımın kalanını arka planda başlatır.", "input_schema": {"type": "object", "properties": {"job_id": _ID}, "required": ["job_id"]}},
    {"name": "stop_rewrite", "description": "Çalışan ya da bekleyen toplu yeniden yazımı durdurur; o ana dek yazılanlar yerel taslakta kalır.", "input_schema": {"type": "object", "properties": {"job_id": _ID}, "required": ["job_id"]}},
]
EXECUTORS = {"rewrite_listings": rewrite_listings, "continue_rewrite": continue_rewrite, "stop_rewrite": stop_rewrite}
LABELS = {"rewrite_listings": "Örnek listing'leri yeniden yazıyor", "continue_rewrite": "Yeniden yazımı başlatıyor", "stop_rewrite": "Yeniden yazımı durduruyor"}
LABELS_EN = {"rewrite_listings": "Rewriting sample listings", "continue_rewrite": "Starting the rewrite", "stop_rewrite": "Stopping the rewrite"}

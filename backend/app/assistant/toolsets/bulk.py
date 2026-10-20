"""Toplu işlem: birçok listing'e AYNI değişikliği uygular. Motor listings/bulk.py'dir (Listing'ler sayfasındaki toplu düzenleme de aynısını kullanır),
seçim listings/selection.py'dedir; burası yalnızca asistan argümanlarını onlara çevirir ve sonuç kartını üretir.

Sorusuz uygulanır çünkü yalnızca YEREL TASLAK yazar (Etsy'ye gitmez, geri alınabilir): sonuç kartındaki düğmelerle kullanıcı hepsini yayınlar, hepsini atar ya da
Listing'ler sayfasında tek tek bakar."""
import json
import time
from collections import Counter

from pydantic import ValidationError
from sqlalchemy import select

from app.assistant.models import ChatMessage
from app.core.i18n import tr
from app.listings import bulk
from app.listings.models import ListingLocal
from app.listings.selection import ListingFilter

SAMPLES = 5


def _changes(a: dict) -> dict:
    """Asistan argümanlarından bulk.BulkChanges alanları."""
    from app.assistant.tools import _ref_changes  # bölüm/kargo/iade/hazırlık/üretim ortağı/yenileme: update_listing ile ortak

    ch: dict = {}
    if a.get("price_change_percent") is not None:
        ch["price"] = bulk.PriceOp(mode="percent", value=float(a["price_change_percent"]), rounding=a.get("price_rounding") or "none")
    elif a.get("price_change_amount") is not None:
        ch["price"] = bulk.PriceOp(mode="amount", value=float(a["price_change_amount"]), rounding=a.get("price_rounding") or "none")
    elif a.get("set_price") is not None:
        ch["price"] = bulk.PriceOp(mode="set", value=float(a["set_price"]), rounding=a.get("price_rounding") or "none")
    if a.get("add_tags") or a.get("remove_tags"):
        ch["tags"] = bulk.TagsOp(add=list(a.get("add_tags") or []), remove=list(a.get("remove_tags") or []))
    if a.get("title_find") is not None:
        ch["title"] = bulk.TextOp(mode="find_replace", find=str(a["title_find"]), replace=str(a.get("title_replace") or ""))
    elif a.get("title_prefix"):
        ch["title"] = bulk.TextOp(mode="prefix", text=str(a["title_prefix"]))
    elif a.get("title_suffix"):
        ch["title"] = bulk.TextOp(mode="suffix", text=str(a["title_suffix"]))
    if a.get("description_find") is not None:
        ch["description"] = bulk.TextOp(mode="find_replace", find=str(a["description_find"]), replace=str(a.get("description_replace") or ""))
    elif a.get("description_prefix"):
        ch["description"] = bulk.TextOp(mode="prefix", text=str(a["description_prefix"]))
    elif a.get("description_suffix"):
        ch["description"] = bulk.TextOp(mode="suffix", text=str(a["description_suffix"]))
    elif a.get("description_set"):
        ch["description"] = bulk.TextOp(mode="set", text=str(a["description_set"]))
    if a.get("quantity") is not None:
        ch["quantity"] = int(a["quantity"])
    if a.get("attributes"):
        ch["attributes"] = [bulk.AttributeItem(name=str(x["name"]), values=[str(v) for v in x.get("values") or []]) for x in a["attributes"] if x.get("name") and x.get("values")]
    if a.get("add_personalization_questions"):
        ch["add_personalization"] = list(a["add_personalization_questions"])
    ch.update(_ref_changes({**a, "shop_section_id": a.get("shop_section_id_new")}))  # "shop_section_id" filtredir; hedef bölüm shop_section_id_new
    return ch


def _filter(a: dict) -> ListingFilter:
    keys = ("listing_ids", "title_contains", "tag_contains", "description_contains", "shop_section_id", "taxonomy_id", "min_price", "max_price", "state", "listing_type")
    return ListingFilter(**{k: a[k] for k in keys if a.get(k) not in (None, [], "")})


def bulk_update_listings(ctx, a: dict) -> dict:
    if a.get("description_set") and not a.get("confirm_overwrite"):
        return {
            "onay_gerekli": True,
            "not": tr(
                "Açıklamanın TAMAMINI tek metinle değiştirmek, her listing'in kendi (ürüne özel, SEO'lu) açıklamasını siler. Kullanıcıya bunu açıkça söyle ve onayını al; "
                "onaylarsa confirm_overwrite=true ile tekrar çağır. Yalnızca bir cümleyi değiştirmek istiyorsa description_find/description_replace kullan.",
                "Replacing the WHOLE description with one text deletes each listing's own (product-specific, SEO) description. Tell the user plainly and get their confirmation; "
                "if they confirm, call again with confirm_overwrite=true. If they only want to change a sentence, use description_find/description_replace.",
            ),
        }
    try:
        flt = _filter(a)
        ch = _changes(a)
        if not ch:
            return {"error": "Değişiklik belirtilmedi."}
        if flt.is_empty() and not a.get("all_listings"):
            return {"error": "Hedef belirtilmedi: listing_ids, title_contains, tag_contains, shop_section_id, taxonomy_id, fiyat aralığı ya da listing_type ver. Kullanıcı tüm listing'leri istiyorsa all_listings=true ver."}
        changes = bulk.BulkChanges(**ch)
    except (ValidationError, ValueError) as exc:
        return {"error": str(exc)[:300]}
    results = bulk.stage_filtered(ctx.db, ctx.shop, flt, changes)
    if not results:
        return {"error": "Filtreye uyan listing yok."}
    done = [r for r in results if r["ok"] and r["changed"]]
    skipped = Counter(("zaten aynı" if r["ok"] else r["error"]) for r in results if not (r["ok"] and r["changed"]))
    samples = [{"id": r["id"], "title": r["title"][:70], "before": r["before"], "after": r["after"], **({"description": r["description"]} if r.get("description") else {})} for r in done[:SAMPLES]]
    ctx.cards.append({
        "type": "bulk_result", "listing_ids": [r["id"] for r in done], "inspected": len(results), "changed": len(done),
        "skipped": [{"reason": reason, "count": n} for reason, n in skipped.most_common(6)], "samples": samples, "ops": list(ch),
    })
    return {
        "incelenen": len(results), "degisen": len(done), "atlanan_nedenleriyle": dict(skipped), "ornekler": samples,
        "not": tr(
            "Hepsi yalnızca yerel taslak olarak yazıldı, Etsy'ye gitmedi. Sohbetteki kartta 'Etsy'de yayınla', 'Vazgeç' ve 'Listing'lerde gör' düğmeleri var; kullanıcıya bunu söyle, "
            "ayrıca onay isteme. Çok sayıda listing'i aynı anda değiştirmek etki ölçümünü bulandırır, kısaca hatırlat.",
            "Everything was written as local drafts only and nothing went to Etsy. The chat card has 'Publish on Etsy', 'Discard' and 'View in Listings' buttons; tell the user, do not ask for further confirmation. "
            "Changing many listings at once blurs impact measurement; mention it briefly.",
        ),
    }


def _last_bulk_ids(ctx) -> list[int]:
    """Bu sohbetteki en son toplu değişikliğin listing kimlikleri: bu turdaki kart, yoksa kayıtlı en yeni "bulk_result" kartı."""
    for card in reversed(ctx.cards):
        if card.get("type") == "bulk_result" and card.get("listing_ids"):
            return list(card["listing_ids"])
    if ctx.session_id is None:
        return []
    for cards_json in ctx.db.scalars(select(ChatMessage.cards_json).where(ChatMessage.session_id == ctx.session_id, ChatMessage.role == "assistant").order_by(ChatMessage.id.desc()).limit(20)):
        for card in reversed(json.loads(cards_json or "[]")):
            if card.get("type") == "bulk_result" and card.get("listing_ids"):
                return list(card["listing_ids"])
    return []


def publish_staged_batch(ctx, a: dict) -> dict:
    """Son toplu değişikliğin taslaklarını Etsy'ye SIRAYLA yayınlar. Yayın sırası tarayıcıda çalışır (sonuç kartındaki "Etsy'de yayınla" düğmesiyle aynısı);
    burada yalnızca hâlâ yayınlanmamış listing'ler seçilir ve onay sonrası ilerleme kartı otomatik başlatılır."""
    ids = _last_bulk_ids(ctx)
    if not ids:
        return {"error": tr("Yayınlanacak bir toplu değişiklik yok; önce toplu değişikliği yap.", "There is no bulk change to publish; make the bulk change first.")}
    pending = set(ctx.db.scalars(select(ListingLocal.listing_id).where(ListingLocal.shop_id == ctx.shop.id, ListingLocal.listing_id.in_(ids))))
    ids = [i for i in ids if i in pending]  # zaten yayınlanmış ya da vazgeçilenler çıkar
    if not ids:
        return {"error": tr("Son toplu değişikliğin bekleyen taslağı kalmamış (yayınlanmış ya da vazgeçilmiş).", "The last bulk change has no pending drafts left (published or discarded).")}
    if not a.get("confirm"):
        return {
            "pending_confirmation": True, "listing_sayisi": len(ids),
            "not": tr(
                "Bu, listing'leri GERÇEKTEN Etsy'ye yayınlar (canlıya yansır, geri dönüşü zor). Kullanıcı sohbette AÇIKÇA onaylarsa (evet/yap/gönder) confirm=true ile TEKRAR çağır; onaylamadıysa asla çağırma. Kaç listing olduğunu söyle.",
                "This REALLY publishes the listings to Etsy (goes live, hard to undo). If the user explicitly confirms in chat (yes/do it/send), call again with confirm=true; never call it otherwise. Say how many listings there are.",
            ),
        }
    ctx.cards.append({
        "type": "bulk_result", "listing_ids": ids, "inspected": len(ids), "changed": len(ids), "skipped": [], "samples": [], "ops": [],
        "autostart": True, "started_at": int(time.time() * 1000),  # kart görünür görünmez sırayla yayını başlatır (yalnızca taze kartta)
    })
    return {
        "baslatildi": len(ids),
        "not": tr(
            "Yayın SIRAYLA başladı; sohbetteki kart ilerlemeyi gösteriyor. Listing'ler bu sekme açıkken tek tek yayınlanır (Etsy hız sınırı yüzünden zaman alabilir): kullanıcıya sekmeyi kapatmamasını söyle.",
            "Publishing has started one by one; the card in the chat shows progress. Listings are published while this tab is open (Etsy's rate limit can make it slow): ask the user not to close the tab.",
        ),
    }


TOOLS: list[dict] = [
    {
        "name": "publish_staged_batch",
        "description": "ONAY GEREKİR. Son TOPLU değişikliğin (bulk_update_listings sonucu) yerel taslaklarını Etsy'ye SIRAYLA yayınlar (canlıya yansır): 'hepsini Etsy'ye gönder'. confirm=true verilmeden yalnızca kaç listing olduğunu özetler. Listing listing publish_listing_draft çağırma; toplu iş için bunu kullan.",
        "input_schema": {"type": "object", "properties": {"confirm": {"type": "boolean"}}, "required": []},
    },
    {
        "name": "bulk_update_listings",
        "description": "Birçok listing'e AYNI değişikliği TOPLU uygular (ör. 'metal garage sign fiyatlarını %20 artır', 'bütün hediye listing'lerine Holiday=Christmas', 'stokları 20 yap'). SORUSUZ uygular çünkü yalnızca YEREL TASLAK yazar (Etsy'ye gitmez): sonuçta kart çıkar, kullanıcı hepsini yayınlar/atar. Hedefi filtrelerle belirt: listing_ids, title_contains, tag_contains, shop_section_id, taxonomy_id, min_price/max_price, state (varsayılan yalnızca aktifler), listing_type (physical/download). Kullanıcı 'bütün/tüm/hepsi' dediyse all_listings=true ver; hedef hiç yoksa hata döner. Değişiklikler: fiyat (yüzde/tutar/sabit), stok (quantity), etiket ekle/çıkar, başlıkta bul-değiştir/önek/sonek, kategori özellikleri (attributes: Holiday, Occasion…; her listing kendi kategorisine göre doğrulanır, özelliği olmayan atlanır), kişiselleştirme sorusu ekle, bölüm/kargo/iade/hazırlık/üretim ortağı/yenileme, hazır açıklama şablonu. Dijital listing'lerde kargo/iade/hazırlık/üretim ortağı atlanır. AÇIKLAMA: bir cümleyi/ifadeyi değiştir (description_find + description_replace), başa/sona ekle (description_prefix / description_suffix); hedef süzgeci gerekmez, ifadesi olmayan listing değişmeden atlanır, yeni metin zaten varsa tekrar eklenmez. Açıklamanın TAMAMINI tek metinle değiştirmek (description_set) her listing'in kendi açıklamasını siler: önce kullanıcıdan açık onay al ve confirm_overwrite=true ver. Bunlar YAPAY ZEKÂ değildir, kredi harcamaz; rewrite_listings kullanma.",
        "input_schema": {"type": "object", "properties": {
            "listing_ids": {"type": "array", "items": {"type": "integer"}}, "title_contains": {"type": "string"}, "tag_contains": {"type": "string"},
            "description_contains": {"type": "string", "description": "Açıklamasında bu metin birebir geçen listing'ler (arama ile aynı eşleşme)"},
            "shop_section_id": {"type": "integer"}, "taxonomy_id": {"type": "integer"}, "min_price": {"type": "number"}, "max_price": {"type": "number"},
            "state": {"type": "string", "enum": ["active", "inactive", "draft", "any"]}, "listing_type": {"type": "string", "enum": ["physical", "download"]},
            "all_listings": {"type": "boolean", "description": "Hedef filtresi olmadan TÜM aktif listing'ler: yalnızca kullanıcı açıkça söylediyse"},
            "price_change_percent": {"type": "number", "description": "10 = %10 zam, -5 = %5 indirim"}, "price_change_amount": {"type": "number"}, "set_price": {"type": "number"},
            "price_rounding": {"type": "string", "enum": ["none", "x.99", "x.00"]},
            "quantity": {"type": "integer", "description": "Tüm kombinasyonların stoğu (1–999)"},
            "add_tags": {"type": "array", "items": {"type": "string"}}, "remove_tags": {"type": "array", "items": {"type": "string"}},
            "title_find": {"type": "string"}, "title_replace": {"type": "string"}, "title_prefix": {"type": "string"}, "title_suffix": {"type": "string"},
            "attributes": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "values": {"type": "array", "items": {"type": "string"}}}, "required": ["name", "values"]}},
            "add_personalization_questions": {"type": "array", "description": "Kişiselleştirme sorularına EKLER: {question_text, question_type, required, max_allowed_characters, instructions, options}", "items": {"type": "object"}},
            "shop_section_id_new": {"type": "integer", "description": "Listing'leri BU bölüme taşı (filtredeki shop_section_id ile karıştırma)"},
            "shipping_profile_id": {"type": "integer"}, "return_policy_id": {"type": "integer"}, "readiness_state_id": {"type": "integer"},
            "production_partner_ids": {"type": "array", "items": {"type": "integer"}}, "should_auto_renew": {"type": "boolean"},
            "description_template_id": {"type": "integer", "description": "Hazır açıklama metni (list_description_templates)"},
            "description_find": {"type": "string", "description": "Açıklamada aranan ifade (birebir eşleşir, boşluk/noktalama dahil)"}, "description_replace": {"type": "string", "description": "Yerine yazılacak metin (boş = sil)"},
            "description_prefix": {"type": "string"}, "description_suffix": {"type": "string"},
            "description_set": {"type": "string", "description": "Açıklamanın TAMAMI bu metinle değişir (yıkıcı; confirm_overwrite şart)"},
            "confirm_overwrite": {"type": "boolean", "description": "Yalnızca description_set için: kullanıcı tüm açıklamaların silineceğini bilerek onayladıysa"},
        }, "required": []},
    },
]
EXECUTORS = {"bulk_update_listings": bulk_update_listings, "publish_staged_batch": publish_staged_batch}
LABELS = {"bulk_update_listings": "Toplu değişiklik uyguluyor", "publish_staged_batch": "Toplu yayını başlatıyor"}
LABELS_EN = {"bulk_update_listings": "Applying bulk changes", "publish_staged_batch": "Starting the bulk publish"}

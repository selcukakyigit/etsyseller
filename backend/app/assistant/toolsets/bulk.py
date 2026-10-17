"""Toplu işlem: birçok listing'e AYNI değişikliği uygular. Motor listings/bulk.py'dir (Listing'ler sayfasındaki toplu düzenleme de aynısını kullanır),
seçim listings/selection.py'dedir; burası yalnızca asistan argümanlarını onlara çevirir ve sonuç kartını üretir.

Sorusuz uygulanır çünkü yalnızca YEREL TASLAK yazar (Etsy'ye gitmez, geri alınabilir): sonuç kartındaki düğmelerle kullanıcı hepsini yayınlar, hepsini atar ya da
Listing'ler sayfasında tek tek bakar."""
from collections import Counter

from pydantic import ValidationError

from app.core.i18n import tr
from app.listings import bulk
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
    if a.get("quantity") is not None:
        ch["quantity"] = int(a["quantity"])
    if a.get("attributes"):
        ch["attributes"] = [bulk.AttributeItem(name=str(x["name"]), values=[str(v) for v in x.get("values") or []]) for x in a["attributes"] if x.get("name") and x.get("values")]
    if a.get("add_personalization_questions"):
        ch["add_personalization"] = list(a["add_personalization_questions"])
    ch.update(_ref_changes({**a, "shop_section_id": a.get("shop_section_id_new")}))  # "shop_section_id" filtredir; hedef bölüm shop_section_id_new
    return ch


def _filter(a: dict) -> ListingFilter:
    keys = ("listing_ids", "title_contains", "tag_contains", "shop_section_id", "taxonomy_id", "min_price", "max_price", "state", "listing_type")
    return ListingFilter(**{k: a[k] for k in keys if a.get(k) not in (None, [], "")})


def bulk_update_listings(ctx, a: dict) -> dict:
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
    samples = [{"id": r["id"], "title": r["title"][:70], "before": r["before"], "after": r["after"]} for r in done[:SAMPLES]]
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


TOOLS: list[dict] = [
    {
        "name": "bulk_update_listings",
        "description": "Birçok listing'e AYNI değişikliği TOPLU uygular (ör. 'metal garage sign fiyatlarını %20 artır', 'bütün hediye listing'lerine Holiday=Christmas', 'stokları 20 yap'). SORUSUZ uygular çünkü yalnızca YEREL TASLAK yazar (Etsy'ye gitmez): sonuçta kart çıkar, kullanıcı hepsini yayınlar/atar. Hedefi filtrelerle belirt: listing_ids, title_contains, tag_contains, shop_section_id, taxonomy_id, min_price/max_price, state (varsayılan yalnızca aktifler), listing_type (physical/download). Kullanıcı 'bütün/tüm/hepsi' dediyse all_listings=true ver; hedef hiç yoksa hata döner. Değişiklikler: fiyat (yüzde/tutar/sabit), stok (quantity), etiket ekle/çıkar, başlıkta bul-değiştir/önek/sonek, kategori özellikleri (attributes: Holiday, Occasion…; her listing kendi kategorisine göre doğrulanır, özelliği olmayan atlanır), kişiselleştirme sorusu ekle, bölüm/kargo/iade/hazırlık/üretim ortağı/yenileme, hazır açıklama şablonu. Dijital listing'lerde kargo/iade/hazırlık/üretim ortağı atlanır.",
        "input_schema": {"type": "object", "properties": {
            "listing_ids": {"type": "array", "items": {"type": "integer"}}, "title_contains": {"type": "string"}, "tag_contains": {"type": "string"},
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
        }, "required": []},
    },
]
EXECUTORS = {"bulk_update_listings": bulk_update_listings}
LABELS = {"bulk_update_listings": "Toplu değişiklik uyguluyor"}
LABELS_EN = {"bulk_update_listings": "Applying bulk changes"}

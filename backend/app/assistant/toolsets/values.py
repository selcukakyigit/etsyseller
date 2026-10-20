"""Listing alanlarındaki değerlerin analizi (salt okunur): "bu form sorusu / varyasyon seçeneği kaç listing'de var, kaç farklı yazılışı var". Motor listings/values.py'dir."""
from app.core.i18n import tr
from app.listings import values


def analyze_listing_values(ctx, a: dict) -> dict:
    try:
        out = values.analyze(ctx.db, ctx.shop, str(a.get("field") or ""), a.get("contains") or None, a.get("state") or "any", int(a.get("limit") or 20))
    except ValueError as exc:
        return {"error": str(exc)}
    out["not"] = tr(
        "Salt okunur. 'degerler' en çok listing'de geçenden başlar; 'yazilislar' dolu ise aynı değerin farklı yazılışları var (büyük/küçük harf, boşluk, tırnak) ve her birinin sayısı verilmiştir. "
        "'veri_olmayan_listing' kişiselleştirmesi henüz eşitlenmemiş listing'lerdir (sayılmadı). Az sayıda listing'i düzenlemek için mevcut listing araçlarını (edit_personalization_question, "
        "edit_inventory, add/remove_variation_option, set_listing_attributes) kullan; çok sayıdaysa bu alan için toplu düzenleme aracı olmadığını söyle.",
        "Read-only. 'degerler' starts with the value found in the most listings; when 'yazilislar' is filled the same value is spelled differently (case, spacing, quotes) with a count for each. "
        "'veri_olmayan_listing' are listings whose personalization is not synced yet (not counted). To edit a few listings use the existing listing tools (edit_personalization_question, "
        "edit_inventory, add/remove_variation_option, set_listing_attributes); for many listings say there is no bulk editing tool for this field yet.",
    )
    return out


TOOLS: list[dict] = [{
    "name": "analyze_listing_values",
    "description": "Listing alanlarındaki DEĞERLERİ sayar (salt okunur): 'bu kişiselleştirme sorusu kaç listing'de var, kaç farklı yazılışı var', 'hangi varyasyon seçenekleri kullanılıyor', 'Material özelliği hangi değerlerle dolu', 'en çok kullanılan etiketler'. field: personalization_question (form sorusu metni), personalization_option (açılır liste seçenekleri), variation_name (varyasyon adı), variation_option (varyasyon adı: seçenek), attribute (özellik adı: değer), tag, material. contains: yalnızca bu metni içeren değerler. Düzenleme yapmaz.",
    "input_schema": {"type": "object", "properties": {
        "field": {"type": "string", "enum": list(values.FIELDS)}, "contains": {"type": "string", "description": "Yalnızca bu metni içeren değerler (büyük/küçük harf duyarsız)"},
        "state": {"type": "string", "enum": ["active", "inactive", "draft", "any"], "description": "Varsayılan: tüm durumlar"}, "limit": {"type": "integer", "description": "En çok kaç değer (varsayılan 20)"},
    }, "required": ["field"]},
}]
EXECUTORS = {"analyze_listing_values": analyze_listing_values}
LABELS = {"analyze_listing_values": "Alan değerlerini sayıyor"}
LABELS_EN = {"analyze_listing_values": "Counting field values"}

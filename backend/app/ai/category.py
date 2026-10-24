"""Listing kategorisini Etsy'nin kategori ağacında gezinerek seçme.

Etsy'nin kategori ağacı sabittir (15 ana kategori, ~3000 düğüm). Kelime eşleşmesi ya da kısa aday listesi alakasız kategoriler seçtirdiği için
(Address Signs, Laptop Trays…) küçük bir model çağrısı ağaçta aşağı iner: her seviyede yalnızca o düğümün çocuklarını görür ve "ürün hangisine girer"
diye seçer. Hiçbir çocuk ürüne net uymuyorsa ya da ürün birden çok çocuğa bölünüyorsa o düğümde durur (daha genel kategori). Mağazanın kendi kategorileri yalnızca eşitlikte ipucudur (çok çeşitli ürün satan mağazada kısayol yanlış kategoriye çekiyordu). Sonuç ağaçta
gerçekten var olan bir düğümdür; uydurma kategori çıkamaz. Model katalogdaki "vision" görevinden gelir (bkz. ai/vision.py)."""
import json
import re

from app.ai.vision import ask_text, text_model

MAX_LEVELS = 8


def _uses(node: dict, used_ids: set[int]) -> bool:
    """Düğümün kendisi ya da altındaki bir kategori mağazada kullanılıyor mu?"""
    return node["id"] in used_ids or any(_uses(c, used_ids) for c in node.get("children") or [])


def navigate(title: str, description: str, tags: list[str], materials: list[str], roots: list[dict], used_ids: set[int]) -> int | None:
    """roots: Etsy seller-taxonomy düğümleri ({id, name, children}). Döner: seçilen düğümün kimliği (yaprak olmayabilir) ya da None."""
    model = text_model("vision")
    product = f"Title: {title}\nDescription: {' '.join(description.split())[:500]}\nTags: {', '.join(tags)}\nMaterials: {', '.join(materials)}"
    level, current, trail = roots, None, []
    for _ in range(MAX_LEVELS):
        options = [{"id": n["id"], "name": n["name"], "shop_uses": _uses(n, used_ids)} for n in level]
        can_stop = len(trail) >= 2  # en az iki seviye inilmeden durulamaz (üst kategoride erken durmak keyfi sonuç veriyordu)
        prompt = (
            "You are placing an Etsy listing into Etsy's category tree, one level at a time.\n"
            f"{product}\n\n"
            f"Current location: {' > '.join(trail) if trail else '(top level)'}\n"
            f"Choose the child category where buyers would look for this product: {json.dumps(options, ensure_ascii=False)}\n\n"
            "Rules:\n"
            "- Choose by what the product IS and how buyers browse for it, not by incidental words in the title.\n"
            "- 'shop_uses' marks categories the shop already sells in; use them ONLY to break a tie between categories that fit equally well. The shop may sell many unrelated kinds of products; never pick a category just because the shop uses it.\n"
            + ('- Go deeper only while a child describes THIS kind of product. Answer "stop" if no child clearly fits, if the remaining children are narrower product types that do not match (e.g. "Signs" for decorative art that is not a sign), or if the product is multi-purpose and the children would split it; the current category is then final (a broader category is fine).\n' if can_stop else "")
            + 'Return ONLY JSON: {"id": ' + ('<child id or "stop">' if can_stop else "<child id>") + "}"
        )
        raw = ask_text(model, prompt)
        match = re.search(r"\{.*\}", raw, re.S)
        try:
            choice = json.loads(match.group(0)).get("id") if match else None
        except (json.JSONDecodeError, AttributeError):
            choice = None
        if choice == "stop" and can_stop:
            break
        node = next((n for n in level if str(n["id"]) == str(choice)), None)
        if node is None:
            break  # geçersiz cevap: o ana kadarki seçim kalır
        current = node
        trail.append(node["name"])
        level = node.get("children") or []
        if not level:
            break
    return current["id"] if current is not None else None

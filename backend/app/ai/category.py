"""Listing kategorisini Etsy'nin kategori ağacında gezinerek seçme.

Etsy'nin kategori ağacı sabittir (15 ana kategori, ~3000 düğüm). Kelime eşleşmesi ya da kısa aday listesi alakasız kategoriler seçtirdiği için
(Address Signs, Laptop Trays…) küçük bir model çağrısı ağaçta aşağı iner: her seviyede yalnızca o düğümün çocuklarını görür ve "ürün hangisine girer"
diye seçer. Hiçbir çocuk ürüne net uymuyorsa ya da ürün birden çok çocuğa bölünüyorsa o düğümde durur (daha genel kategori). Sonuç ağaçta
gerçekten var olan bir düğümdür; uydurma kategori çıkamaz. Model katalogdaki "vision" görevinden gelir (bkz. ai/vision.py)."""
import json
import re

from app.ai.client import get_anthropic_client, get_openai_client, openai_limits
from app.ai.vision import VisionError, text_model
from app.billing import metering

MAX_LEVELS = 8


def _uses(node: dict, used_ids: set[int]) -> bool:
    """Düğümün kendisi ya da altındaki bir kategori mağazada kullanılıyor mu?"""
    return node["id"] in used_ids or any(_uses(c, used_ids) for c in node.get("children") or [])


def _ask(model, prompt: str) -> str:
    try:
        if model.provider == "anthropic":
            resp = get_anthropic_client().messages.create(model=model.model_id, max_tokens=120, messages=[{"role": "user", "content": prompt}])
            raw = "".join(b.text for b in resp.content if b.type == "text")
        else:
            resp = get_openai_client().chat.completions.create(model=model.model_id, messages=[{"role": "user", "content": prompt}], **openai_limits(model.model_id, 120))
            raw = resp.choices[0].message.content or ""
        metering.record_response("vision", model, resp)
        return raw
    except Exception as exc:  # noqa: BLE001
        raise VisionError(f"Yapay zekâ sağlayıcısı hata verdi: {str(exc)[:200]}") from exc


def navigate(title: str, description: str, tags: list[str], materials: list[str], roots: list[dict], used_ids: set[int], used_paths: list[str] | None = None, used_options: list[dict] | None = None) -> int | None:
    """roots: Etsy seller-taxonomy düğümleri ({id, name, children}). Döner: seçilen düğümün kimliği (yaprak olmayabilir) ya da None."""
    model = text_model("vision")
    product = f"Title: {title}\nDescription: {' '.join(description.split())[:500]}\nTags: {', '.join(tags)}\nMaterials: {', '.join(materials)}"
    if used_options:  # mağazanın kendi kategorilerinden birine giriyorsa doğrudan o (aynı tür ürün aynı kategoriye): tutarlı ve hızlı
        listing = json.dumps(used_options, ensure_ascii=False)
        raw = _ask(model, f"{product}\n\nThe shop already sells in these categories: {listing}\nDoes this product belong in one of them (the same kind of product the shop usually sells)? "
                          'Answer ONLY JSON: {"id": <category id or null>}')
        match = re.search(r"\{.*\}", raw, re.S)
        try:
            known = json.loads(match.group(0)).get("id") if match else None
        except (json.JSONDecodeError, AttributeError):
            known = None
        if known is not None and any(str(o["id"]) == str(known) for o in used_options):
            return int(known)
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
            "- 'shop_uses' marks categories the shop already sells in; prefer them when they fit equally well.\n"
            + ('- Go deeper only while a child describes THIS kind of product. Answer "stop" if no child clearly fits, if the remaining children are narrower product types that do not match (e.g. "Signs" for decorative art that is not a sign), or if the product is multi-purpose and the children would split it; the current category is then final (a broader category is fine).\n' if can_stop else "")
            + 'Return ONLY JSON: {"id": ' + ('<child id or "stop">' if can_stop else "<child id>") + "}"
        )
        raw = _ask(model, prompt)
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

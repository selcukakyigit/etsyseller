"""Ürün resmini GÜÇLÜ görsel modele (katalogdaki "vision" görevi) okutup görünen ürünü ve tasarımı kısa İngilizce bir tanımla alır.

Sohbet modeli resmi yüzeysel okuyup başlık önerilerinde yanlış motif yazıyordu ("industrial silhouette geometric", oysa birbirine geçen hücre/balon deseni). `brief_check`, modelin yazdığı
`design` alanını bu okumayla karşılaştırır; uyuşmuyorsa modeli düzeltir. Okuma oturumdaki resim kimliklerine göre bellekte tutulur (aynı resim için bir çağrı). Model/anahtar yoksa None: denetim atlanır."""
import json
import re

from app.ai.vision import ask_text, text_model

_CACHE: dict[tuple, dict | None] = {}
_PROMPT = (
    "Look at this product photo. Describe ONLY what is visible. Return ONLY JSON: "
    '{"product": "<what the item is, 2-5 English words>", "design": "<8-16 English words: the overall shape, the layout, the lettering style and the main decorative elements; NEVER mention colour (the item is sold in several colours)>"} '
    "Be concrete (for example 'round badge shape with a banner name plate, serif cut-out lettering and a thin border'), not generic ('text in circle shape'). "
    "If the photo shows sample text such as a name, do NOT copy the words; say only that there is lettering and what it looks like. "
    "Ignore the room and the background. Do not guess size, material or brand."
)


def read(images: list[tuple[bytes, str]], key: tuple) -> dict | None:
    """{"product", "design"} ya da None (model yok, okunamadı)."""
    if key in _CACHE:
        return _CACHE[key]
    result = None
    try:
        raw = ask_text(text_model("vision"), _PROMPT, max_tokens=160, images=images)
        match = re.search(r"[{].*[}]", raw, re.S)
        data = json.loads(match.group(0)) if match else {}
        product, design = " ".join(str(data.get("product") or "").split())[:60], " ".join(str(data.get("design") or "").split())[:160]
        result = {"product": product, "design": design} if design else None
    except Exception:  # noqa: BLE001 - görsel model yok/hata: denetim atlanır
        result = None
    if len(_CACHE) > 200:
        _CACHE.clear()
    _CACHE[key] = result
    return result

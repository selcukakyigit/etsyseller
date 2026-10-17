"""Sosyal medya (Pinterest) içeriği: listing'ten pin başlığı, açıklaması ve hashtag'ler üretir (tek amaçlı model çağrısı).
Model katalogdaki "vision" görevinden gelir (bkz. ai/vision.py). Yazıların listing'de olmayan bir iddiayı içermemesi için yalnızca verilen bilgi kullanılır."""
import json
import re

from app.ai.client import get_anthropic_client, get_openai_client, openai_limits
from app.ai.vision import VisionError, text_model
from app.billing import metering

MAX_PINS = 8
TITLE_MAX = 100  # Pinterest pin başlığı sınırı
DESC_MAX = 500  # Pinterest açıklama sınırı


def pins(title: str, description: str, tags: list[str], price: str, shop_name: str, count: int, language: str = "en") -> list[dict]:
    """Döner: [{title, description, hashtags[], board}]. Başlık ve açıklama sınırlara kırpılır."""
    count = max(1, min(int(count), MAX_PINS))
    prompt = (
        f"Write {count} DIFFERENT Pinterest pins to promote this Etsy listing. Each pin takes a different angle (gift idea, home styling, occasion, problem it solves, detail/quality...).\n"
        f"Shop: {shop_name}\nListing title: {title}\nDescription: {' '.join(description.split())[:700]}\nTags: {', '.join(tags)}\nPrice: {price}\n\n"
        "Rules:\n"
        f"- Write in {'English' if language == 'en' else 'Turkish'}.\n"
        f"- title: max {TITLE_MAX} characters, searchable keywords first, no clickbait, no emojis spam.\n"
        f"- description: max {DESC_MAX} characters, 2-3 natural sentences with keywords, end with a soft call to action (e.g. 'Find it on Etsy'). Never invent features, discounts, shipping promises or materials that are not in the listing.\n"
        "- hashtags: 3-5 relevant hashtags without the # sign.\n"
        "- board: a short suggested Pinterest board name.\n"
        'Return ONLY JSON: {"pins": [{"title": "...", "description": "...", "hashtags": ["..."], "board": "..."}]}'
    )
    model = text_model("vision")
    try:
        if model.provider == "anthropic":
            resp = get_anthropic_client().messages.create(model=model.model_id, max_tokens=2000, messages=[{"role": "user", "content": prompt}])
            raw = "".join(b.text for b in resp.content if b.type == "text")
        else:
            resp = get_openai_client().chat.completions.create(model=model.model_id, messages=[{"role": "user", "content": prompt}], **openai_limits(model.model_id, 2000))
            raw = resp.choices[0].message.content or ""
        metering.record_response("vision", model, resp)
    except Exception as exc:  # noqa: BLE001
        raise VisionError(f"Yapay zekâ sağlayıcısı hata verdi: {str(exc)[:200]}") from exc
    match = re.search(r"\{.*\}", raw, re.S)
    try:
        items = json.loads(match.group(0))["pins"] if match else []
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise VisionError("Yapay zekâ beklenmeyen bir cevap verdi, tekrar dene.") from exc
    out = []
    for i in items[:count]:
        if not isinstance(i, dict) or not i.get("title"):
            continue
        out.append({
            "title": " ".join(str(i["title"]).split())[:TITLE_MAX], "description": " ".join(str(i.get("description") or "").split())[:DESC_MAX],
            "hashtags": [re.sub(r"[^\w]", "", str(h)) for h in (i.get("hashtags") or []) if re.sub(r"[^\w]", "", str(h))][:5], "board": " ".join(str(i.get("board") or "").split())[:60],
        })
    if not out:
        raise VisionError("Yapay zekâ pin üretemedi, tekrar dene.")
    return out

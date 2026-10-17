"""Kategori özelliklerinin (renk, malzeme, kullanım yeri, tatil…) tek amaçlı bir model çağrısıyla doldurulması.

Asistanın genel istemi uzundur ve ucuz modeller özellikleri atlar; bu çağrı yalnızca bu işi yapar: listing bilgisi, ilk fotoğraflar ve
kategorinin özellik tanımları verilir, model YALNIZCA izin verilen değerlerden seçer. Model katalogdaki "vision" görevinden gelir
(bkz. ai/vision.py); sonuç yine fields.apply_attributes ile doğrulanır, yani uydurma değer yazılamaz."""
import base64
import json
import re

from app.ai.client import get_anthropic_client, get_openai_client, openai_limits
from app.ai.images import for_llm
from app.ai.vision import VisionError, text_model
from app.billing import metering

MAX_PHOTOS = 2


def suggest(title: str, description: str, tags: list[str], materials: list[str], variations: list[dict], defs_brief: list[dict], photos: list[tuple[bytes, str]]) -> list[dict]:
    """defs_brief: [{name, required, max_choices, allowed}]. photos: [(bayt, içerik türü)]. Döner: [{name, values}]."""
    if not defs_brief:
        return []
    prompt = (
        "You fill in the attribute fields of an Etsy listing.\n"
        f"Title: {title}\nDescription: {' '.join(description.split())[:700]}\nTags: {', '.join(tags)}\nMaterials: {', '.join(materials)}\n"
        f"Variations already defined on the listing (their information must NOT be repeated as an attribute): {json.dumps(variations, ensure_ascii=False)[:600]}\n\n"
        f"Attribute definitions (JSON): {json.dumps(defs_brief, ensure_ascii=False)}\n\n"
        "Rules:\n"
        "- Choose values ONLY from each attribute's allowed list, spelled exactly as listed. Respect max_choices.\n"
        "- Fill an attribute when the product, photos or description make it clear (material, orientation, framed/unframed, lighting, handle, "
        "dishwasher/microwave safe only if stated, etc.). For giftable products also pick fitting Holiday and Occasion values "
        "(e.g. Christmas, Valentine's Day, Mother's Day, Father's Day, Birthday, Wedding, Anniversary) up to max_choices.\n"
        "- If a variation already covers an attribute (e.g. a Color variation and the Color/Primary color attribute, or a Size variation and Size), skip that attribute.\n"
        "- Skip attributes you cannot determine; never guess facts such as safety or capacity that are not stated or visible.\n"
        'Return ONLY JSON: {"attributes": [{"name": "<attribute name>", "values": ["<allowed value>", ...]}]}'
    )
    blobs = []
    for data, ctype in photos[:MAX_PHOTOS]:
        d, c = for_llm(data, ctype)
        blobs.append((c, base64.b64encode(d).decode()))
    model = text_model("vision")
    try:
        if model.provider == "anthropic":
            content = [{"type": "image", "source": {"type": "base64", "media_type": m, "data": d}} for m, d in blobs] + [{"type": "text", "text": prompt}]
            resp = get_anthropic_client().messages.create(model=model.model_id, max_tokens=1500, messages=[{"role": "user", "content": content}])
            raw = "".join(b.text for b in resp.content if b.type == "text")
        else:
            content = [{"type": "text", "text": prompt}] + [{"type": "image_url", "image_url": {"url": f"data:{m};base64,{d}"}} for m, d in blobs]
            resp = get_openai_client().chat.completions.create(model=model.model_id, messages=[{"role": "user", "content": content}], **openai_limits(model.model_id, 1500))
            raw = resp.choices[0].message.content or ""
        metering.record_response("vision", model, resp)
    except Exception as exc:  # noqa: BLE001
        raise VisionError(f"Yapay zekâ sağlayıcısı hata verdi: {str(exc)[:200]}") from exc
    match = re.search(r"\{.*\}", raw, re.S)
    try:
        items = json.loads(match.group(0))["attributes"] if match else []
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise VisionError("Yapay zekâ beklenmeyen bir cevap verdi, tekrar dene.") from exc
    return [{"name": str(i.get("name", "")), "values": [str(v) for v in i.get("values") or []]} for i in items if isinstance(i, dict) and i.get("values")]

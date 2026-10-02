"""Görselden alt metin üretimi (OpenAI ya da Claude; hangisinin anahtarı varsa, önce ayarlardaki sağlayıcı)."""
import base64
import json
import re

from app.ai.client import get_anthropic_client, get_openai_client
from app.ai.images import for_llm
from app.core import blobstore
from app.core.config import settings

ALT_MAX = 125  # ekran okuyucular için önerilen uzunluk; Etsy sınırı 500


class VisionError(Exception):
    pass


def _provider() -> str:
    order = [settings.ai_provider, "anthropic" if settings.ai_provider == "openai" else "openai"]
    for p in order:
        if (settings.anthropic_api_key if p == "anthropic" else settings.openai_api_key):
            return p
    raise VisionError("Yapay zekâ API anahtarı tanımlı değil. Ayarlar > API anahtarları bölümünden ekleyin.")


def _clip(text: str) -> str:
    text = " ".join(text.split()).strip(' "')
    if len(text) <= ALT_MAX:
        return text
    cut = text[:ALT_MAX]
    return (cut.rsplit(" ", 1)[0] if " " in cut else cut).rstrip(" ,;-–")


def generate_alt_texts(items: list[dict], title: str) -> list[str]:
    """items: [{"path", "content_type"}]. Her fotoğraf için tek cümlelik alt metin; sıra korunur."""
    if not items:
        return []
    n = len(items)
    prompt = (
        f'Write alt text for each of the {n} product photos of this Etsy listing titled: "{title}".\n'
        "Rules: describe what is actually visible (the product, color, material, size cues, room/setting, angle); factual and natural; "
        f"at most {ALT_MAX} characters each; do not start with 'image of' or 'photo of'; no keyword stuffing; "
        "write in the same language as the listing title. "
        f'Return ONLY JSON: {{"alt_texts": [{n} strings in the same order as the photos]}}'
    )
    blobs = []
    for i in items:
        data, ctype = for_llm(blobstore.read(i["path"]), i["content_type"])
        blobs.append((ctype, base64.b64encode(data).decode()))
    provider = _provider()
    try:
        if provider == "anthropic":
            content = [{"type": "image", "source": {"type": "base64", "media_type": m, "data": d}} for m, d in blobs] + [{"type": "text", "text": prompt}]
            resp = get_anthropic_client().messages.create(model=settings.anthropic_model, max_tokens=1200, messages=[{"role": "user", "content": content}])
            raw = "".join(b.text for b in resp.content if b.type == "text")
        else:
            content = [{"type": "text", "text": prompt}] + [{"type": "image_url", "image_url": {"url": f"data:{m};base64,{d}"}} for m, d in blobs]
            resp = get_openai_client().chat.completions.create(
                model=settings.openai_model, messages=[{"role": "user", "content": content}], max_tokens=1200
            )
            raw = resp.choices[0].message.content or ""
    except Exception as exc:  # noqa: BLE001
        raise VisionError(f"Yapay zekâ sağlayıcısı hata verdi: {str(exc)[:200]}") from exc
    match = re.search(r"\{.*\}", raw, re.S)
    try:
        texts = json.loads(match.group(0))["alt_texts"] if match else []
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise VisionError("Yapay zekâ beklenmeyen bir cevap verdi, tekrar dene.") from exc
    texts = [_clip(str(t)) for t in texts][:n]
    if len(texts) != n:
        raise VisionError("Yapay zekâ her fotoğraf için alt metin üretemedi, tekrar dene.")
    return texts

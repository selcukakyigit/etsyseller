"""Asistanın düz metin olarak sorduğu bir soruya, kullanıcının DÜĞMEYLE cevaplayabileceği 2-4 kısa seçenek çıkarır (küçük model, tek kısa çağrı).

Cevap sayı, ad, fiyat gibi serbest metin gerektiriyorsa ya da soru değilse boş döner: o zaman düğme gösterilmez. Hata/anahtar yoksa da boş (düğme olmadan devam edilir)."""
import json
import re

from app.ai.vision import ask_text, text_model

MAX_OPTIONS = 4
MAX_LEN = 38


def suggest(question: str) -> list[str]:
    text = " ".join((question or "").split())[-500:]
    if "?" not in text:
        return []
    prompt = (
        "An assistant asked a user the question below. If the user can answer by picking between 2-4 short, concrete alternatives (yes/no, one of the ways offered in the question, "
        f"a choice between two formats), return exactly those answers in the SAME language as the question, each under {MAX_LEN} characters, worded the way the user would reply. "
        "If the question needs a free-form answer (a number, a price, a name, a description) or is not a real question, return an empty list.\n\n"
        f"Question: {text}\n\nReturn ONLY JSON: " + '{"options": ["...", "..."]}'
    )
    try:
        raw = ask_text(text_model("vision"), prompt, max_tokens=140)
    except Exception:  # noqa: BLE001 - model yok / sağlayıcı hatası: düğmesiz devam
        return []
    match = re.search(r"[{].*[}]", raw, re.S)
    try:
        options = json.loads(match.group(0)).get("options") if match else []
    except (ValueError, AttributeError):
        return []
    clean = [" ".join(str(o).split()) for o in options or [] if str(o).strip()]
    return clean[:MAX_OPTIONS] if 2 <= len(clean) and all(len(o) <= MAX_LEN for o in clean[:MAX_OPTIONS]) else []

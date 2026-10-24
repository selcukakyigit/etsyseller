"""Yapay zekâ adımı (tek, kısa çağrı): (1) kartta olmayan bir kelime taşıyan adayların bu ürün için doğru olup olmadığını onaylar
("metal fairy garden decor" bir yusufçuk kazığı için değildir), (2) veri zayıfsa alıcının arayacağı yeni ifadeleri ve soracağı soruları önerir.

YZ veri yerine geçmez: yeni fikirler "tahmin" sayılır, uygunluk süzgecinden geçer, ölçülmüş adayın önüne geçemez ve ölçüm için kuyruğa girer
(`sources.queue_measurement`); bir sonraki plan onları ölçülü veriyle kullanır. Model yoksa ya da hata verirse doğrulanmamış adaylar ELENİR
(temkinli) ve plan eldeki veriyle kurulur. Model katalogdaki "seo" görevinden gelir."""
import json
import logging
import re

from app.listing_plan.facts import Facts

log = logging.getLogger(__name__)
MIN_CANDIDATES = 20  # uygun aday bundan azsa yeni fikir istenir
MAX_CHECK = 40

PROMPT = """You help an Etsy seller. Product facts:
{facts}

1) "check": from these candidate search phrases, return ONLY those that truly describe THIS product (same product type; true for the facts):
{check}
2) "phrases": {want} new phrases real buyers type into Etsy or Google for THIS exact product. Only phrases true for the facts; no brand
names; no colors; 2-4 words, at most 20 characters; mix product names and synonyms, materials, uses, styles, occasions and recipients.
3) "questions": up to 6 short, natural questions buyers ask before buying (start with how/what/can/does/is/will).
4) "synonyms": up to 6 other single words buyers use for this PRODUCT TYPE (e.g. sunglasses -> shades, eyewear). Product-type names only,
never features or claims (not "polarized", "waterproof").
Return ONLY JSON: {{"check": ["..."], "phrases": ["..."], "questions": ["..."], "synonyms": ["..."]}}"""


def run(facts: Facts, to_check: list[str], want_new: bool) -> tuple[set[str], list[str], list[str], list[str]]:
    """(onaylanan adaylar, yeni ifadeler, sorular, ürün türü eşanlamlıları). Eşanlamlılar karta eklenir (shades, eyewear): ürün türü adı
    güvenlidir; özellik kelimesi (polarized) ise karta girmez, onu taşıyan ifade doğrulanmadıkça plana alınmaz."""
    from app.ai.vision import VisionError, ask_text, text_model

    if not to_check and not want_new:
        return set(), [], [], []
    summary = f"Product: {facts.product}\n{' '.join(facts.text.split())[:900]}"
    prompt = PROMPT.format(facts=summary, check=", ".join(to_check[:MAX_CHECK]) or "(none)", want="About 25" if want_new else "0")
    try:
        raw = ask_text(text_model("seo"), prompt, max_tokens=900, task="seo")
        data = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
    except (VisionError, AttributeError, ValueError):
        log.warning("Kelime doğrulama/fikir adımı çalışmadı", exc_info=True)
        return set(), [], [], []

    def clean(items) -> list[str]:
        return [" ".join(str(x).lower().split()).rstrip("?") for x in items or [] if str(x).strip()]

    allowed = set(to_check)
    synonyms = [w for w in clean(data.get("synonyms")) if w.isalpha() and len(w) > 2][:6]
    return {p for p in clean(data.get("check")) if p in allowed}, [p for p in clean(data.get("phrases")) if len(p) <= 20][:30], clean(data.get("questions"))[:6], synonyms

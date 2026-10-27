"""Açıklamanın TANITIM kompozisyonunu yazar: alıcıya hitap eden, sıcak ve akıcı iki kısa paragraf ("If you are looking for a garage sign made just for you, this is it…").

Genel SEO motoru (`seo.generate_seo_suggestion`) kuru bir olgu listesi yazıyordu; bu çağrı yalnızca bu işi yapar: verilen olgulardan (ürün, fotoğrafta görünen tasarım, malzeme, boyut/renk seçenekleri,
kişiselleştirme) 90-130 kelimelik bir tanıtım. Fiyat, stok, kargo, dayanıklılık/hava koşulu/bakım iddiası, abartılı övgü ve uydurma yoktur. DETAILS bölümü bunun dışında, sunucuda olgulardan kurulur.
Model yoksa ya da çıktı kurallara uymuyorsa None: çağıran mevcut açıklamayı korur."""
import re

from app.ai.vision import ask_text, text_model

MIN_WORDS = 45
MAX_WORDS = 170
_BANNED = re.compile(
    r"\$|\busd\b|\bstock\b|\bunits\b|\bshipping\b|\bwarranty\b|\bdurab\w*|\bweather\w*|\boutdoor\w*|\brust\w*|\blong[- ]lasting\b|\bperfect\b|\bbest\b|\bamazing\b|\bstunning\b|\bbeautiful\b|\bhigh[- ]quality\b|\bwelcome\b|\bsturdy\b|\brobust\b|\bpremium\b|\bcherished\b|\bhobb\w*|\bclassic cars?\b|\bgift\w*",
    re.IGNORECASE,
)

_PROMPT = """You write the opening of an Etsy listing description in English.

Write TWO short, flowing paragraphs (together {low}-{high} words), like a friendly seller talking to a buyer. No bullet points, no headings.
Paragraph 1: an inviting opening that speaks to the buyer (for example "If you are looking for a {product} made just for you, this is it."), then what the item is and how it looks, using the visible design below.
Paragraph 2: how personalization works (only if stated), how many sizes and colors/finishes there are (say the NUMBER and mention the variety, do not list prices), the material, and where it fits (only uses that follow from the product, e.g. a garage sign goes in a garage or workshop).

Use ONLY these facts. Never invent anything else.
- Product: {product}
- Visible design (from the photo): {design}
- Material: {material}
- Sizes: {sizes}
- Colors/finishes: {colors}
- Personalization: {personalization}
- Keywords to use naturally (do not stuff): {keywords}

Hard rules: do not invent hobbies, occasions, buyers or life situations (only the places that directly follow from the product type, e.g. a garage sign goes in a garage or workshop); no prices or currency, no stock numbers, no shipping or policy talk, no durability / weather / outdoor / rust / care / warranty claims, no hype words (perfect, best, amazing, stunning, beautiful, high quality), no greeting like "welcome". Do not mention anything not listed above.
Return ONLY the two paragraphs, separated by one blank line."""


def write(*, product: str, design: str, material: str, sizes: list[str], colors: list[str], personalization: str, keywords: list[str]) -> str | None:
    """İki paragraflık tanıtım metni ya da None (model yok / kurallara uymuyor)."""
    prompt = _PROMPT.format(
        low=90, high=130, product=product or "item", design=design or "(not visible / not stated)", material=material or "(not stated)",
        sizes=", ".join(sizes) if sizes else "(single size)", colors=", ".join(colors) if colors else "(single option)",
        personalization=personalization or "none", keywords=", ".join(keywords) or "(none)",
    )
    try:
        raw = ask_text(text_model("vision"), prompt, max_tokens=420)
    except Exception:  # noqa: BLE001 - model yok / sağlayıcı hatası: çağıran mevcut açıklamayı korur
        return None
    return clean(raw)


def clean(raw: str) -> str | None:
    """Model iyi yazar ama arada yasak kelimeli cümle ("perfect for…", "durable") kaçırır: o CÜMLELER atılır, kalan metin yeterliyse kullanılır (tamamını reddetmek iyi paragrafı da çöpe atıyordu)."""
    paragraphs = [" ".join(p.split()) for p in re.split(r"\n\s*\n", (raw or "").strip()) if p.strip()]
    paragraphs = [p for p in paragraphs if not p.lstrip().startswith(("#", "-", "•", "*"))][:2]
    kept = []
    for p in paragraphs:
        sentences = [x for x in re.split(r"(?<=[.!?])\s+", p) if x and not _BANNED.search(x)]
        if sentences:
            kept.append(" ".join(sentences))
    text = "\n\n".join(kept)
    words = len(re.findall(r"\w+", text))
    if len(kept) < 2 or not MIN_WORDS <= words <= MAX_WORDS:
        return None
    return text

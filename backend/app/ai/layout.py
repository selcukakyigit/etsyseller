"""Açıklamanın yazım düzeni (bkz. standard.LAYOUT_RULES): modelin çıktısını sunucuda DETERMİNİSTİK toparlar; içeriğe dokunmaz, yalnızca biçimi düzeltir.

Mağazanın sabit bölümleri (☛ ➲ ✔ ツ ile başlayan kendi stili) korunur: ilk sabit bölüm işaretinden sonra yalnızca fazla boş satırlar ve satır sonu boşlukları temizlenir."""
import re

FIXED_MARKERS = "☛➲✔✓ツ"
# Etsy açıklamaları düz metindir; emoji kalabalığı tutarsız görünür. Mağazanın kendi sembolleri emoji sayılmaz.
_EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-⛿✀-➿️]")
_BULLET = re.compile(r"^[-*•·▪►]\s+(?=\S)")
_HEADER = re.compile(r"^[A-Z][A-Z &/'’-]{2,30}$")
_QUESTION = re.compile(r"^Q\s*[:.)]", re.I)
_LABEL = re.compile(r"^[^:\n]{2,30}:$")  # "Features:" gibi tek başına bir etiket satırı
MAX_HEADER_CHARS = 34


def is_emoji(ch: str) -> bool:
    return ch not in FIXED_MARKERS and bool(_EMOJI.match(ch))


def is_header(line: str) -> bool:
    return bool(_HEADER.match(line.strip()))


def _tidy_line(s: str) -> str:
    """Tek ürün satırı: emoji temizlenir; madde işareti '•' olur; emojili ya da 'Etiket:' biçimindeki kısa satır BÜYÜK HARFLİ başlık olur."""
    emoji_lead = bool(s) and is_emoji(s[0])
    s = "".join(ch for ch in s if not is_emoji(ch) and ch != "️").strip()
    if _BULLET.match(s):
        return "• " + _BULLET.sub("", s)
    short = 0 < len(s) <= MAX_HEADER_CHARS and not s.endswith((".", "!"))
    if short and (emoji_lead or _LABEL.match(s)):
        return s.rstrip(":?").strip().upper()
    return s


_INLINE_BULLET = re.compile(r"\s+[•·▪►]\s+(?=\S)")
_INLINE_LABEL = re.compile(r"(?<=[.!?])\s+(?=[A-Z]{3,}(?: [A-Z]{3,})?:\s)")  # "...air dry. CARE: spot clean" gibi cümle sonrası BÜYÜK HARFLİ etiket


def _split_inline(line: str) -> list[str]:
    """Tek satıra sıkışmış maddeleri ("... • Materials: x • Sizes: y. CARE: z") ayrı satırlara böler; içeriğe dokunmaz."""
    if not line.strip() or line.strip()[0] in FIXED_MARKERS:
        return [line]
    parts = _INLINE_BULLET.split(line)
    out = [parts[0]] + ["• " + p for p in parts[1:]]
    final: list[str] = []
    for part in out:
        pieces = _INLINE_LABEL.split(part)
        final.append(pieces[0])
        for p in pieces[1:]:  # "CARE: x" → "• Care: x"
            label, rest = p.split(":", 1)
            final.append(f"• {label.capitalize()}:{rest}")
    return [x for x in final if x.strip()]


# Olmayan bilgiyi söyleyen satırlar ("Personalization: none", boş QUESTIONS bölümü) açıklamadan çıkarılır.
_NONE_LINE = re.compile(r"^[ \t]*[•\-*]?[ \t]*(?:Personali[sz]ation|Customi[sz]ation)[ \t]*:[ \t]*(?:none|not available|not personali[sz]able|no|n/a)(?![A-Za-z])\.?[ \t]*\n?", re.I | re.M)
_NO_QUESTIONS = re.compile(r"^[ \t]*QUESTIONS[ \t]*\n+(?:[ \t]*[•\-*]?[ \t]*(?:No (?:questions|faq)|[(]?answered:|[(]?skipped)[^\n]*\n?)+", re.I | re.M)

_META = re.compile(r"^[ \t]*[•\-*]?[ \t]*No [A-Za-z ]{2,30} section (?:added|included)\.?[ \t]*\n?", re.I | re.M)  # modelin kendi notu ("No QUESTIONS section added.") açıklamaya sızmasın
_NO_PERSONALIZATION = re.compile(r"[ \t]*No personali[sz]ation is (?:offered|available|included)\.?", re.I)


def normalize(text: str) -> str:
    text = _NO_PERSONALIZATION.sub("", _META.sub("", _NO_QUESTIONS.sub("", _NONE_LINE.sub("", text))))
    raw = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lines = [ln.rstrip() for src in raw for ln in (_split_inline(src) if src.strip() else [src])]
    out: list[str] = []
    fixed = False  # ilk sabit bölüm işaretinden sonrası olduğu gibi kalır
    for ln in lines:
        s = ln.strip()
        if s and s[0] in FIXED_MARKERS:
            fixed = True
        out.append(ln if fixed or not s else _tidy_line(s))
    result: list[str] = []
    fixed = False
    for ln in out:
        if not ln.strip():
            if result and result[-1] != "":
                result.append("")
            continue
        fixed = fixed or ln.strip()[0] in FIXED_MARKERS
        if not fixed and result and result[-1] != "" and (is_header(ln) or _QUESTION.match(ln)) and not is_header(result[-1]):
            result.append("")  # başlıktan ve her soru-cevap çiftinden önce boş satır
        result.append(ln)
    while result and result[-1] == "":
        result.pop()
    return "\n".join(result)

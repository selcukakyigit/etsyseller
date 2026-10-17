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


def _is_emoji(ch: str) -> bool:
    return ch not in FIXED_MARKERS and bool(_EMOJI.match(ch))


def is_header(line: str) -> bool:
    return bool(_HEADER.match(line.strip()))


def _tidy_line(s: str) -> str:
    """Tek ürün satırı: emoji temizlenir; madde işareti '•' olur; emojili ya da 'Etiket:' biçimindeki kısa satır BÜYÜK HARFLİ başlık olur."""
    emoji_lead = bool(s) and _is_emoji(s[0])
    s = "".join(ch for ch in s if not _is_emoji(ch) and ch != "️").strip()
    if _BULLET.match(s):
        return "• " + _BULLET.sub("", s)
    short = 0 < len(s) <= MAX_HEADER_CHARS and not s.endswith((".", "!"))
    if short and (emoji_lead or _LABEL.match(s)):
        return s.rstrip(":?").strip().upper()
    return s


def normalize(text: str) -> str:
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
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

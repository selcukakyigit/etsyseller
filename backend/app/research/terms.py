"""Kelime normalizasyonu: büyük/küçük harf ve boşluk farkları aynı kelimedir; özgün yazım `display`te saklanır."""
import re
import unicodedata

MAX_CHARS = 80  # Google Ads sınırı
MAX_WORDS = 10
_SPACE = re.compile(r"\s+")
_EDGE = re.compile(r"^[^\w]+|[^\w]+$")


def normalize(text: str) -> str:
    return _EDGE.sub("", _SPACE.sub(" ", unicodedata.normalize("NFKC", text or "").strip().lower()))


def researchable(term: str) -> bool:
    """Sağlayıcıya sorulabilir mi (boş değil, uzunluk sınırları içinde)."""
    return bool(term) and len(term) <= MAX_CHARS and len(term.split()) <= MAX_WORDS

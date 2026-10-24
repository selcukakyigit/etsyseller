"""Ürün kartı: planın doğruluk kaynağı. Uygunluk süzgeci, niteleyiciler ve SSS cevapları buraya bakar; burada olmayan bilgi "bilinmiyor"dur."""
import re
from dataclasses import dataclass, field

STOP = {"the", "a", "an", "of", "to", "in", "on", "and", "for", "with", "is", "it", "my", "your", "by", "or", "from", "at"}
_WORD = re.compile(r"[^\W_]+(?:'[^\W_]+)?")


def words(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(text or "")]


@dataclass
class Facts:
    product: str  # kısa İngilizce ürün adı ("insulated water bottle"); başlığın ana öbeğinden ya da modelden
    text: str  # bilinen her şey (başlık, açıklama, malzeme, varyasyon, özellik, kullanıcının söyledikleri), küçük harf
    personalizable: bool = False
    variations: dict[str, list[str]] = field(default_factory=dict)

    @property
    def item_words(self) -> set[str]:
        """Ürün adının anlamlı kelimeleri; bir ifadenin "bu ürünle ilgili" sayılması için en az birini taşıması gerekir."""
        return {w for w in words(self.product) if len(w) > 2 and w not in STOP}

    @property
    def known_words(self) -> set[str]:
        return {w for w in words(self.text) if w not in STOP}

    @property
    def colors(self) -> set[str]:
        return {v.lower() for name, vals in self.variations.items() if any(k in name.lower() for k in ("color", "colour", "renk")) for v in vals}


def lead_phrase(title: str) -> str:
    """Başlığın ilk öbeği (virgül, tire, dikey çizgi öncesi): mevcut listing'in ana ifadesi ve ürün adı."""
    first = re.split(r"\s*[,|–—:]\s*|\s+-\s+", (title or "").strip(), maxsplit=1)[0]
    return " ".join(first.split()[:6]).lower()


def from_listing(
    title: str, description: str = "", tags: list[str] | None = None, materials: list[str] | None = None,
    variations: dict[str, list[str]] | None = None, personalizable: bool = False, product: str | None = None, extra: str = "",
) -> Facts:
    variations = variations or {}
    text = "\n".join([
        title or "", description or "", " ".join(tags or []), " ".join(materials or []),
        " ".join(f"{n} {' '.join(v)}" for n, v in variations.items()), extra or "",
    ]).lower()
    return Facts(product=(product or lead_phrase(title)).strip().lower(), text=text, personalizable=personalizable, variations=variations)

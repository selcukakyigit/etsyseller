"""Uygunluk süzgeci: ifade ürün için DOĞRU mu? Puanı ne olursa olsun ürünle çelişen ifade plana girmez.

İzin listesi değil çelişki listesi: ürün kartı Türkçe/eksik olabilir, bu yüzden "kartta geçmeyen her kelime yasak" denmez; yalnızca kartla
çelişen (başka malzeme, kapalı kişiselleştirme, varyasyondaki renk, kartta olmayan ölçü, başka kitle) ve marka içeren ifadeler elenir;
ürünle hiçbir kelimesi örtüşmeyen ifade de ilgisizdir (vesile/alıcı ifadeleri hariç)."""
import re

from app.ai import quality
from app.keywords import scoring
from app.listing_plan.facts import STOP, Facts, words
from app.research.questions import is_question

# Etsy'de sık taklit edilen tüketici markaları (karakter/lisans adları quality.PROTECTED_NAMES'te). Tam liste değildir; bilerek temkinli.
MARKETPLACE_BRANDS = re.compile(
    r"\b(stanley|yeti|hydro ?flask|owala|contigo|camelbak|nalgene|s'?well|ray[- ]?ban|oakley|gucci|prada|chanel|dior|cartier|tiffany|pandora|"
    r"lululemon|north face|carhartt|crocs|vans|converse|airpods|kindle|stanley cup)\b", re.I,
)

MATERIALS = {
    "metal": {"metal", "steel", "stainless", "iron", "aluminum", "aluminium", "brass", "copper", "tin", "bronze"},
    "wood": {"wood", "wooden", "bamboo", "oak", "walnut", "pine", "maple", "plywood"},
    "glass": {"glass", "crystal"},
    "plastic": {"plastic", "acrylic", "resin", "pvc", "silicone"},
    "ceramic": {"ceramic", "porcelain", "stoneware", "clay"},
    "fabric": {"cotton", "linen", "wool", "polyester", "fabric", "canvas", "velvet", "felt"},
    "leather": {"leather", "suede"},
    "paper": {"paper", "cardstock"},
    "acetate": {"acetate"},
}
AUDIENCES = {"kids", "kid", "baby", "toddler", "toddlers", "children", "dog", "dogs", "cat", "cats", "pet", "pets", "teen", "teens"}
DIY_QUESTION = {"engrave", "make", "diy", "paint", "build", "sew", "craft", "print"}
UNVERIFIED = "kartta olmayan kelime: "

# Açılar (farklılık için) ve kartta geçmese de güvenle kullanılabilen genel niteleyiciler: bunların dışında kalan, kartta olmayan bir içerik
# kelimesi (ör. "fairy", "markers") ürünü başka bir ürün türüne çevirebilir; o aday modelle doğrulanır (bkz. ideas.run).
ANGLES = {
    "personalization": {"personalized", "custom", "engraved", "monogram", "name", "initials"},
    "material": set().union(*MATERIALS.values()),
    "use": {"travel", "gym", "hiking", "sports", "office", "kitchen", "garden", "outdoor", "indoor", "wall", "desk", "camping", "beach", "festival", "yard", "patio", "home", "lawn"},
    "style": {"rustic", "vintage", "retro", "modern", "minimalist", "boho", "farmhouse", "industrial", "mod", "70s", "80s", "90s", "geometric", "classic"},
    "feature": {"insulated", "vacuum", "leak", "proof", "waterproof", "foldable", "large", "small", "mini", "set", "double", "wall", "reusable", "thick"},
    "recipient": {"mom", "dad", "her", "him", "men", "women", "teacher", "gardener", "runner", "hiker", "couple", "unisex"},
}
GENERIC = set().union(*ANGLES.values()) | {"decor", "art", "gift", "gifts", "accessory", "accessories", "handmade", "ornament", "item", "style", "lover", "lovers"}


def reason(phrase: str, facts: Facts) -> str | None:
    """Elenme gerekçesi ya da None (uygun)."""
    low = phrase.lower()
    if MARKETPLACE_BRANDS.search(low) or quality.PROTECTED_NAMES.search(low):
        return "marka"
    w = [x for x in words(low) if x not in STOP]
    if is_question(low):
        return "kendin-yap sorusu" if words(low)[:2] == ["how", "to"] and set(w) & DIY_QUESTION else None
    known = facts.known_words
    if not facts.personalizable and quality.PERSONALIZATION.search(low):
        return "kişiselleştirme yok"
    if set(w) & facts.colors:
        return "renk etiketi (renkler varyasyonda)"
    for group, vocab in MATERIALS.items():
        if set(w) & vocab and not known & vocab:
            return f"başka malzeme ({group})"
    missing_aud = (set(w) & AUDIENCES) - known
    if missing_aud:
        return f"kartta olmayan kitle ({', '.join(sorted(missing_aud))})"
    nums = {x for x in w if x[0].isdigit()}
    if nums and not all(any(n.rstrip("mlozcin") in k for k in known) for n in nums):
        return "kartta olmayan ölçü"
    if any(x in scoring._OCCASION for x in w):
        return None  # vesile/alıcı ifadesi ürün kelimesi taşımak zorunda değil
    if not set(w) & known:
        return "ürünle ilgisi yok"
    unknown = sorted(x for x in set(w) - known - GENERIC if not x[0].isdigit())
    if unknown:
        return f"{UNVERIFIED}{', '.join(unknown)}"
    return None


def unverified(why: str | None) -> bool:
    """Kartta olmayan bir içerik kelimesi taşıyan aday ("metal fairy garden decor"): çelişki değil ama doğrulanmadan plana girmez."""
    return bool(why) and why.startswith(UNVERIFIED)

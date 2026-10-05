"""Etsy banner stilleri ve hazır sezon temaları.

Ölçüler Etsy'nin mağaza düzenleme ekranındaki minimumların üstünde, önerilen boyutlardadır. Model görseli `ratio` oranında
üretir (gemini-3.1-flash-image 4:1 ve 8:1'i destekliyor); sonra tam `size` ölçüsüne getirilir. Mini banner'ın oranı 7,5:1
olduğu için 8:1 üretilip yanlardan çok az kırpılır (talimattaki kenar payı bunu karşılar)."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Style:
    key: str
    ratio: str  # modelin üreteceği oran
    size: tuple[int, int]  # son dosyanın piksel ölçüsü
    min_slots: int
    max_slots: int
    description: str  # modele: bu görsel ne olarak kullanılacak


STYLES: dict[str, Style] = {
    "carousel": Style("carousel", "4:1", (3360, 840), 1, 4, "one slide of the rotating banner carousel at the top of the shop page"),
    "big": Style("big", "4:1", (3360, 840), 1, 1, "the large banner across the top of the shop page"),
    "mini": Style("mini", "8:1", (2400, 320), 1, 1, "a slim mini banner across the top of the shop page"),
    "collage": Style("collage", "1:1", (1200, 1200), 2, 4, "one square tile of a 2-4 image collage banner at the top of the shop page"),
}

# Sezon temaları: modele giden sahne tarifi (İngilizce). Arayüzdeki adları ön yüz tutar (iki dilli).
SEASONS: dict[str, str] = {
    "christmas": "Christmas holiday mood: warm string lights, pine branches, soft snow, red and gold accents, cozy and festive.",
    "new_year": "New Year celebration: elegant gold and black, subtle confetti and sparkles, fresh-start mood.",
    "valentines": "Valentine's Day: soft pinks and reds, subtle hearts, romantic warm light, gift-giving mood.",
    "mothers_day": "Mother's Day: soft pastel flowers, gentle morning light, warm and heartfelt gift mood.",
    "fathers_day": "Father's Day: rustic wood, leather and denim tones, warm workshop or cabin feel, gift mood.",
    "spring": "Spring: fresh greenery and blossoms, bright airy daylight, light pastel palette.",
    "summer": "Summer: bright sunshine, outdoor patio or garden, vivid but natural colors, relaxed mood.",
    "autumn": "Autumn: warm orange and brown leaves, golden hour light, cozy rustic textures.",
    "halloween": "Halloween: tasteful orange and black, pumpkins, candles, slightly spooky but friendly.",
    "thanksgiving": "Thanksgiving: harvest table, pumpkins and wheat, warm earthy tones, gratitude mood.",
    "black_friday": "Black Friday / Cyber Monday sale: bold black background with strong accent color, clean modern retail look.",
}

"""Banner üretim talimatı. İngilizce yazılır (görsel modeli İngilizce talimata en iyi uyuyor), metin dili kullanıcınındır.

2026-10-05 testinde model istenmeyen yazılar ekledi: sol üste "Etsy" logosu ve "(Your Shop Name)" gibi yer tutucular.
Etsy API Şartları markanın izinsiz kullanımını yasaklar; bu yüzden TEXT kuralları kesin ve tekrar ediyor."""
from app.banners.styles import SEASONS, Style


def build(style: Style, *, n_products: int, season: str | None, scene: str, headline: str, subline: str, slot: int, slots: int) -> str:
    parts = [
        f"Design {style.description} for an online handmade shop. The image aspect ratio is fixed; fill the whole frame.",
    ]
    if n_products:
        parts.append(
            f"PRODUCTS: The {n_products} attached image(s) are REAL products from this shop. Show these exact products: keep "
            "each product's shape, colors, materials, engraving and any text on it faithful. Do not invent different products "
            "and do not duplicate the same product. Make them the hero of the image, styled like a professional product photo."
        )
    if style.key == "carousel" and slots > 1:
        parts.append(
            f"This is slide {slot + 1} of {slots}. Feature mainly product #{(slot % max(n_products, 1)) + 1} of the attached images "
            "and use a different composition from the other slides, while keeping one consistent visual style."
        )
    if style.key == "collage":
        parts.append("This square tile shows a single product on a simple, clean background that matches the theme.")
    theme = SEASONS.get(season or "", "")
    if theme or scene.strip():
        parts.append("SCENE AND MOOD: " + " ".join(x for x in (theme, scene.strip()) if x))
    else:
        parts.append("SCENE AND MOOD: clean, bright, premium lifestyle look that fits the products.")

    if headline.strip():
        text = f'"{headline.strip()}"' + (f' and, smaller below it, "{subline.strip()}"' if subline.strip() else "")
        parts.append(
            f"TEXT: Render exactly this text and nothing else: {text}. Spell it exactly, character by character, in a clean, "
            "highly legible font with strong contrast. Place it where it does not cover the products."
        )
    else:
        parts.append("TEXT: Do not add any text, letters, words or numbers to the image (text that is physically on a product is fine).")
    parts.append(
        'STRICT RULES: Never write the word "Etsy" and never draw an Etsy or any other brand logo. Never add placeholder text, '
        "brackets, website names, prices, watermarks, borders or frames. Keep all text and important objects inside the central "
        "safe area, at least 8% away from every edge, because the banner is cropped slightly on phones."
    )
    return "\n\n".join(parts)

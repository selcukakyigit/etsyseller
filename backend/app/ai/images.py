"""Yapay zekâya gönderilecek resimleri sınır içine sokar.

Claude resim başına en fazla 5 MB (base64 hâliyle) kabul eder ve 1568 pikselden büyük kenarı zaten küçültür; telefon
fotoğrafları ve taranmış faturalar bunu kolayca aşar. Kullanıcı büyük dosya yükleyebilsin diye dosyanın kendisi olduğu
gibi saklanır, yalnızca yapay zekâya giden kopya küçültülür (en uzun kenar 2000 px, JPEG)."""
import io
import logging

log = logging.getLogger("app.ai.images")

IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp", "image/gif")
MAX_SIDE = 2000
MAX_BYTES = 3_600_000  # base64 ~%33 büyütür: 3,6 MB → ~4,8 MB, 5 MB sınırının altında


def for_llm(content: bytes, content_type: str) -> tuple[bytes, str]:
    """Resim değilse ya da zaten küçükse olduğu gibi döner; değilse küçültülmüş JPEG döner."""
    if content_type not in IMAGE_TYPES:
        return content, content_type
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        img = Image.open(io.BytesIO(content))
        if len(content) <= MAX_BYTES and max(img.size) <= MAX_SIDE:
            return content, content_type
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            flat = Image.new("RGB", img.size, (255, 255, 255))
            flat.paste(img, mask=img.split()[-1])
            img = flat
        else:
            img = img.convert("RGB")
        side = MAX_SIDE
        for quality in (88, 80, 70, 60, 50):
            copy = img.copy()
            copy.thumbnail((side, side))
            buf = io.BytesIO()
            copy.save(buf, format="JPEG", quality=quality, optimize=True)
            if buf.tell() <= MAX_BYTES:
                return buf.getvalue(), "image/jpeg"
            side = int(side * 0.85)
        return buf.getvalue(), "image/jpeg"
    except (UnidentifiedImageError, OSError):
        log.warning("Resim küçültülemedi; olduğu gibi gönderiliyor")
        return content, content_type

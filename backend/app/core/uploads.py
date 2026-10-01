from fastapi import HTTPException, UploadFile

MB = 1024 * 1024
MAX_IMAGE_BYTES = 20 * MB  # Etsy ilan fotoğrafı için fazlasıyla yeterli
MAX_VIDEO_BYTES = 100 * MB  # Etsy ilan videosu sınırı


async def read_limited(file: UploadFile, max_bytes: int, label: str = "Dosya") -> bytes:
    """Yüklemeyi en fazla `max_bytes` kadar okur; aşarsa 413 döner. Sınırsız `file.read()` tek bir istekle sunucunun
    belleğini (Render'da 512 MB) doldurabilirdi."""
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, f"{label} çok büyük (en fazla {max_bytes // MB} MB)")
    return data

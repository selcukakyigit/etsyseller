"""Fotoğraf kırpma (asistanın crop_listing_photo aracı): düzenleyicideki ImageCropper ile aynı mantık — oran, yakınlaştırma ve odak noktası.
Saf görüntü işlemi: veritabanına dokunmaz."""
import io

from PIL import Image, ImageOps

RATIOS = {"1:1": 1.0, "4:3": 4 / 3, "3:4": 3 / 4, "original": None}
OUT_MAX = 2000  # çıktının en uzun kenarı (düzenleyicideki OUT_MAX ile aynı)


def crop_image(content: bytes, ratio: str = "1:1", zoom: float = 1.0, center_x: float = 0.5, center_y: float = 0.5) -> tuple[bytes, str]:
    """`ratio` oranında, `zoom` (1 = oranın sığdığı en geniş alan, 3 = üç kat yakın) kadar yakın ve odak noktası
    (center_x, center_y: 0–1, sol-üst orijin) etrafında kırpılmış JPEG döner: (bayt, mime)."""
    if ratio not in RATIOS:
        raise ValueError("ratio 1:1, 4:3, 3:4 ya da original olmalı.")
    zoom = min(max(float(zoom), 1.0), 4.0)
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(content))).convert("RGB")
    w, h = img.size
    target = RATIOS[ratio] or w / h
    # Oranın sığdığı en büyük pencere, sonra zoom ile daraltılır.
    box_w, box_h = (h * target, h) if w / h > target else (w, w / target)
    box_w, box_h = box_w / zoom, box_h / zoom
    cx = min(max(float(center_x), 0.0), 1.0) * w
    cy = min(max(float(center_y), 0.0), 1.0) * h
    left = min(max(cx - box_w / 2, 0), w - box_w)
    top = min(max(cy - box_h / 2, 0), h - box_h)
    out = img.crop((round(left), round(top), round(left + box_w), round(top + box_h)))
    scale = min(1.0, OUT_MAX / max(out.size))
    if scale < 1:
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=92)
    return buf.getvalue(), "image/jpeg"

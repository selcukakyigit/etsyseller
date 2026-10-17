"""Sosyal içerik: Pinterest pin metinleri (başlık, açıklama, hashtag, pano önerisi) ve dikey pin görseli.
Paylaşım yapılmaz: metinler sohbette kopyalanabilir kartla, görsel indirilebilir resim olarak verilir (Pinterest hesabı bağlantısı yok)."""
import html
import io

from app.ai import social
from app.ai.vision import VisionError
from app.core.i18n import tr

PIN_SIZE = (1000, 1500)  # Pinterest'in önerdiği 2:3 oran


def pinterest_content(ctx, a: dict) -> dict:
    from app.assistant.tools import _work_or_error

    lid = int(a["listing_id"])
    work, err = _work_or_error(ctx, lid)
    if err:
        return err
    products = (work.get("inventory") or {}).get("products", [])
    amounts = [o["price"]["amount"] / o["price"]["divisor"] for p in products for o in p.get("offerings", []) if isinstance(o.get("price"), dict) and o["price"].get("divisor")]
    currency = next((o["price"].get("currency_code") for p in products for o in p.get("offerings", []) if isinstance(o.get("price"), dict)), "")
    price = (f"{min(amounts):g}–{max(amounts):g} {currency}" if amounts and min(amounts) != max(amounts) else (f"{amounts[0]:g} {currency}" if amounts else ""))
    lang = "tr" if str(a.get("language") or "en").lower().startswith("tr") else "en"
    try:
        items = social.pins(html.unescape(work.get("title") or ""), html.unescape(work.get("description") or ""), work.get("tags") or [], price, ctx.shop.shop_name, int(a.get("count") or 5), lang)
    except VisionError as exc:
        return {"error": str(exc)}
    ctx.cards.append({"type": "social_pins", "listing_id": lid, "title": html.unescape(work.get("title") or ""), "pins": items})
    return {"ok": True, "pin_sayisi": len(items), "not": "Pin metinleri sohbette kopyalanabilir kartla gösterildi; metni tekrar yazma. Paylaşım yapılmadı: kullanıcı Pinterest'e kendisi yükler. Pin görseli için make_pin_image'ı öner."}


def make_pin_image(ctx, a: dict) -> dict:
    """Listing fotoğrafından 2:3 dikey pin görseli: fotoğraf kadrajlanır, alta başlık şeridi programla (yapay zekâsız, yazı bozulmaz) eklenir."""
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    from app.assistant import service as chat_service
    from app.assistant.tools import _draft_work, _photo_at
    from app.listings import drafts

    lid = int(a["listing_id"])
    headline = " ".join(str(a.get("headline") or "").split())[:90]
    if not headline:
        return {"error": "headline gerekli (pin görselinin üzerindeki kısa yazı, en fazla ~8 kelime)."}
    work = _draft_work(ctx, lid)
    _ordered, photo = _photo_at(work, int(a.get("photo_number") or 1))
    if photo is None:
        return {"error": "Fotoğraf bulunamadı."}
    try:
        source, _mime = drafts._source_image_bytes(ctx.db, ctx.shop, lid, photo["listing_image_id"], photo.get("draft_file_id"))
        img = ImageOps.fit(ImageOps.exif_transpose(Image.open(io.BytesIO(source))).convert("RGB"), PIN_SIZE, Image.LANCZOS, centering=(0.5, 0.45))
    except (ValueError, FileNotFoundError, OSError) as exc:
        return {"error": f"Fotoğraf okunamadı: {exc}"}
    draw = ImageDraw.Draw(img, "RGBA")
    font = ImageFont.load_default(size=64)
    small = ImageFont.load_default(size=34)
    lines, line = [], ""
    for word in headline.split():  # satırlara böl (en fazla 3 satır)
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= PIN_SIZE[0] - 120 or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    lines = lines[:3]
    band_h = 70 + len(lines) * 80 + 60
    draw.rectangle([0, PIN_SIZE[1] - band_h, PIN_SIZE[0], PIN_SIZE[1]], fill=(20, 20, 20, 205))
    y = PIN_SIZE[1] - band_h + 40
    for text in lines:
        draw.text((60, y), text, font=font, fill=(255, 255, 255, 255))
        y += 80
    draw.text((60, PIN_SIZE[1] - 70), ctx.shop.shop_name, font=small, fill=(217, 119, 87, 255))  # marka vurgu rengi
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92)
    saved = chat_service.save_image(ctx.db, ctx.shop, ctx.session_id, "pin.jpg", "image/jpeg", buf.getvalue())
    ctx.cards.append({
        "type": "chat_image_edited", "image_id": saved["id"], "image_url": saved["url"], "prompt": tr("Pinterest pin görseli", "Pinterest pin image") + f": {headline}"[:200],
        "source_image_id": None, "source_listing_id": None, "source_photo": None, "listing_id": None, "added": False, "edit_url": None, "listing_image_id": None,
    })
    return {"ok": True, "not": "2:3 pin görseli sohbette gösterildi (dokununca büyür, indirilebilir). Yazıyı sunucu ekledi, yapay zekâ çizmedi."}


TOOLS: list[dict] = [
    {
        "name": "pinterest_content",
        "description": "Bir listing için Pinterest pin metinleri üretir (farklı açılardan başlık, açıklama, hashtag, pano önerisi); sohbette kopyalanabilir kartla gösterilir. Paylaşım yapmaz. 'Pinterest için içerik', 'sosyal medya metni' isteklerinde. language: en (varsayılan, Etsy alıcıları için; kullanıcı Türkçe isterse tr).",
        "input_schema": {"type": "object", "properties": {"listing_id": {"type": "integer"}, "count": {"type": "integer", "description": "1-8, varsayılan 5"}, "language": {"type": "string", "enum": ["en", "tr"]}}, "required": ["listing_id"]},
    },
    {
        "name": "make_pin_image",
        "description": "Listing fotoğrafından 2:3 dikey Pinterest pin görseli yapar: fotoğraf kadrajlanır, altına kısa başlık yazısı ve mağaza adı programla eklenir (yapay zekâ yok, yazı bozulmaz, ücretsiz). headline en fazla ~8 kelime.",
        "input_schema": {"type": "object", "properties": {"listing_id": {"type": "integer"}, "photo_number": {"type": "integer", "description": "Varsayılan 1 (ana fotoğraf)"}, "headline": {"type": "string"}}, "required": ["listing_id", "headline"]},
    },
]
EXECUTORS = {"pinterest_content": pinterest_content, "make_pin_image": make_pin_image}
LABELS = {"pinterest_content": "Pin metinleri yazıyor", "make_pin_image": "Pin görseli hazırlıyor"}
LABELS_EN = {"pinterest_content": "Writing pin copy", "make_pin_image": "Making the pin image"}

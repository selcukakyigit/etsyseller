"""Etsy'nin listing yazma kuralları TEK yerde (updateListing / özellik / görsel belgesi). Düzenleyici formu, yayın öncesi kontrol, AI önerisi, asistan ve toplu düzenleme
aynı kuralları buradan alır; Etsy'nin reddedeceği değer forma girmez, girerse yayından ÖNCE alanıyla birlikte gösterilir.

Karakter kuralları belgedeki düzenli ifadelerin karşılığıdır (`\\p{L}` harf, `\\p{Nd}` rakam, `\\p{Zs}` boşluk, `\\p{P}` noktalama, `\\p{Sm}` matematik simgesi):
- etiket: harf, rakam, boşluk, `-`, `'`, ™ © ®
- materyal ve stil: yalnızca harf, rakam ve boşluk
- başlık: harf, rakam, noktalama, matematik simgesi, boşluk, ™ © ®; `% : & +` karakterlerinin her biri en çok bir kez"""
import unicodedata

from app.core.i18n import tr

TITLE_MAX = 140
TAG_COUNT = 13
TAG_MAX_LEN = 20
MAX_MATERIALS = 13
MAX_STYLES = 2
MAX_STYLE_LEN = 45
ALT_TEXT_MAX = 500
ONCE_ONLY = "%:&+"  # başlıkta her biri en çok bir kez
MARKS = "™©®"

MADE_GROUP = ("who_made", "when_made", "is_supply")  # Etsy: üçü birlikte istenir
ECGT_GROUP = ("ecgt_garan_brand", "ecgt_garan_years", "ecgt_garan_model", "ecgt_garan_guarantee_details")  # biri doluysa dördü zorunlu
ECGT_LIMITS = {"ecgt_garan_brand": 25, "ecgt_garan_model": 20, "ecgt_garan_guarantee_details": 255}
ECGT_TEXT_LIMIT = 255  # diğer AB alanları
ECGT_YEARS = (3, 99)
POSITIVE = ("item_weight", "item_length", "item_width", "item_height")

# Alanın düzenleyicideki bölümü (sayfadaki `sec-…` kimlikleri).
SECTION = {
    "title": "sec-details", "tags": "sec-attributes", "materials": "sec-attributes", "style": "sec-attributes", "made": "sec-made",
    "dimensions": "sec-shipping", "ecgt": "sec-shipping", "properties": "sec-attributes", "inventory": "sec-options", "images": "sec-media",
}


def _category_ok(ch: str, prefixes: tuple[str, ...], extra: str) -> bool:
    return ch in extra or unicodedata.category(ch).startswith(prefixes)


def _only(text: str, prefixes: tuple[str, ...], extra: str = "") -> str:
    """İzin verilmeyen karakterler boşluğa çevrilir, boşluklar sadeleşir."""
    return " ".join("".join(c if _category_ok(c, prefixes, extra) else " " for c in str(text)).split())


_TAG = (("L", "Nd", "Zs"), "-'" + MARKS)
_WORD = (("L", "Nd", "Zs"), "")
_TITLE = (("L", "Nd", "P", "Sm", "Zs"), MARKS)


def _unquote(text: str) -> str:
    return str(text).replace("’", "'").replace("‘", "'")


def clean_tag(text: str) -> str:
    """Etiketten Etsy'nin kabul etmediği karakterler çıkar ("metal sign!" → "metal sign", "a/b" → "a b"). Uzunluk burada kesilmez (bkz. ai/quality.fix_long_tags)."""
    return _only(_unquote(text), *_TAG)


def clean_word(text: str) -> str:
    """Materyal/stil: yalnızca harf, rakam, boşluk ("powder-coated" → "powder coated", kesme işareti silinir)."""
    return _only(str(text).replace("’", "").replace("'", ""), *_WORD)


def clean_words(values: list, limit: int, max_len: int | None = None) -> list[str]:
    out: list[str] = []
    for v in values:
        text = clean_word(v)
        if max_len:
            text = text[:max_len]
        if text and text.lower() not in {o.lower() for o in out}:
            out.append(text)
    return out[:limit]


def clean_title(text: str) -> str:
    """Başlıkta izin verilmeyen karakterler çıkar; `% : & +` karakterlerinin yalnızca ilki kalır."""
    seen: set[str] = set()
    out = []
    for c in _only(text, *_TITLE).replace(" ", " "):
        if c in ONCE_ONLY:
            if c in seen:
                out.append(" ")
                continue
            seen.add(c)
        out.append(c)
    return " ".join("".join(out).split())


def issue(key: str, label: str, message: str, section: str, **extra) -> dict:
    return {"key": key, "label": label, "message": message, "section": section, **extra}


def _title_issues(title: str) -> list[dict]:
    out = []
    if len(title) > TITLE_MAX:
        out.append(issue("title", tr("Başlık", "Title"), tr(f"Başlık {len(title)} karakter; en fazla {TITLE_MAX} olabilir.", f"The title is {len(title)} characters; the limit is {TITLE_MAX}."), SECTION["title"]))
    if clean_title(title) != " ".join(title.split()):
        repeated = [c for c in ONCE_ONLY if title.count(c) > 1]
        what = tr(f"{', '.join(repeated)} karakteri başlıkta en fazla bir kez kullanılabilir.", f"{', '.join(repeated)} can be used only once in the title.") if repeated else tr("Başlıkta Etsy'nin kabul etmediği karakterler var.", "The title has characters Etsy does not accept.")
        out.append(issue("title", tr("Başlık", "Title"), what, SECTION["title"]))
    return out


def _word_list_issues(key: str, label: str, values: list, limit: int, max_len: int | None, charset: str) -> list[dict]:
    out = []
    if len(values) > limit:
        out.append(issue(key, label, tr(f"{label}: en fazla {limit} tane olabilir.", f"{label}: at most {limit} allowed."), SECTION[key]))
    for v in values:
        cleaner = clean_tag if key == "tags" else clean_word
        if max_len and len(v) > max_len:
            out.append(issue(key, label, tr(f"{label} «{v}» {max_len} karakteri aşıyor.", f"{label} «{v}» is longer than {max_len} characters."), SECTION[key], value=v))
        elif cleaner(v) != " ".join(str(v).split()):
            out.append(issue(key, label, tr(f"{label} «{v}»: {charset}", f"{label} «{v}»: {charset}"), SECTION[key], value=v))
    return out


def issues_for(work: dict, *, core: set[str] | None = None, props: set[int] | None = None, inventory: bool = True, images: bool = True) -> list[dict]:
    """Etsy'ye GÖNDERİLECEK alanların sorunları (hiçbir şey yazılmadan önce). `core`: gönderilecek temel alan anahtarları (None: hepsi);
    değişmeyen alanlar denetlenmez, çünkü Etsy'de zaten kabul edilmiş eski değerlere bu yüzden takılınmaz."""
    sending = (lambda k: True) if core is None else (lambda k: k in core)
    out: list[dict] = []
    if sending("title") and work.get("title"):
        out += _title_issues(str(work["title"]))
    if sending("tags"):
        out += _word_list_issues("tags", tr("Etiket", "Tag"), list(work.get("tags") or []), TAG_COUNT, TAG_MAX_LEN, tr("yalnızca harf, rakam, boşluk, - ve ' kullanılabilir.", "only letters, numbers, spaces, - and ' are allowed."))
    if sending("materials"):
        out += _word_list_issues("materials", tr("Materyal", "Material"), list(work.get("materials") or []), MAX_MATERIALS, None, tr("yalnızca harf, rakam ve boşluk kullanılabilir (tire ve noktalama yok).", "only letters, numbers and spaces are allowed (no hyphens or punctuation)."))
    if sending("style"):
        out += _word_list_issues("style", tr("Stil", "Style"), list(work.get("style") or []), MAX_STYLES, MAX_STYLE_LEN, tr("yalnızca harf, rakam ve boşluk kullanılabilir.", "only letters, numbers and spaces are allowed."))
    for key in POSITIVE:
        value = work.get(key)
        if sending(key) and value is not None and value <= 0:
            label = {"item_weight": tr("Ağırlık", "Weight"), "item_length": tr("Uzunluk", "Length"), "item_width": tr("Genişlik", "Width"), "item_height": tr("Yükseklik", "Height")}[key]
            out.append(issue(key, label, tr(f"{label} 0'dan büyük olmalı (ya da boş bırak).", f"{label} must be greater than 0 (or leave it empty)."), SECTION["dimensions"]))
    if any(sending(k) for k in MADE_GROUP):
        missing = [k for k in ("who_made", "when_made") if not work.get(k)]
        if missing:
            out.append(issue("who_made", tr("Kim yaptı / ne zaman", "Who made it / when"), tr("«Kim yaptı» ve «Ne zaman yapıldı» birlikte seçilmeli.", "«Who made it» and «When was it made» must both be chosen."), SECTION["made"]))
    if any(sending(k) for k in ECGT_GROUP):
        filled = [k for k in ECGT_GROUP if work.get(k) not in (None, "")]
        if filled and len(filled) < len(ECGT_GROUP):
            out.append(issue("ecgt", "GPSR", tr("AB ticari garanti bilgisi için marka, model, yıl ve garanti ayrıntısı birlikte doldurulmalı.", "For the EU commercial guarantee, brand, model, years and guarantee details must all be filled."), SECTION["ecgt"]))
        years = work.get("ecgt_garan_years")
        if years is not None and not ECGT_YEARS[0] <= int(years) <= ECGT_YEARS[1]:
            out.append(issue("ecgt", "GPSR", tr(f"Garanti süresi {ECGT_YEARS[0]} ile {ECGT_YEARS[1]} yıl arasında olmalı.", f"The guarantee must be {ECGT_YEARS[0]} to {ECGT_YEARS[1]} years."), SECTION["ecgt"]))
        for key, limit in {**ECGT_LIMITS, **{k: ECGT_TEXT_LIMIT for k in ("ecgt_other_commercial_guarantee_details", "ecgt_after_sales_service_info", "ecgt_software_update_details")}}.items():
            if len(str(work.get(key) or "")) > limit:
                out.append(issue("ecgt", "GPSR", tr(f"GPSR metni en fazla {limit} karakter olabilir.", f"A GPSR text can be at most {limit} characters."), SECTION["ecgt"]))
    for p in work.get("properties", []):
        if props is None or p.get("property_id") in props:
            if not p.get("value_ids") and _has_paren(p.get("values")):
                label = str(p.get("property_name") or p.get("property_id"))
                out.append(issue("property", label, tr(f"«{label}» değerinde parantez kullanılamaz.", f"Parentheses are not allowed in the value of «{label}»."), SECTION["properties"], property_id=p.get("property_id")))
    if inventory:
        for prod in (work.get("inventory") or {}).get("products", []):
            for pv in prod.get("property_values", []):
                if not pv.get("value_ids") and _has_paren(pv.get("values")):
                    label = str(pv.get("property_name") or "")
                    out.append(issue("inventory", label, tr(f"Varyasyon seçeneğinde parantez kullanılamaz: «{', '.join(pv['values'])}».", f"Parentheses are not allowed in a variation option: «{', '.join(pv['values'])}»."), SECTION["inventory"]))
                    break
    if images:
        for img in work.get("images", []):
            if len(str(img.get("alt_text") or "")) > ALT_TEXT_MAX:
                out.append(issue("images", tr("Fotoğraf alt metni", "Photo alt text"), tr(f"Fotoğraf alt metni en fazla {ALT_TEXT_MAX} karakter olabilir.", f"Photo alt text can be at most {ALT_TEXT_MAX} characters."), SECTION["images"]))
                break
    seen: set[tuple] = set()
    return [i for i in out if not (i["key"], i["message"]) in seen and not seen.add((i["key"], i["message"]))]


def _has_paren(values) -> bool:
    return any("(" in str(v) or ")" in str(v) for v in values or [])


def complete_groups(changed: dict, work: dict) -> dict:
    """Etsy, bazı alanları birlikte ister: `who_made`/`when_made`/`is_supply` üçlüsünden biri değişiyorsa üçü de gönderilir; AB garanti alanlarında da dördü."""
    out = dict(changed)
    if any(k in out for k in MADE_GROUP):
        for k in MADE_GROUP:
            if work.get(k) is not None:
                out.setdefault(k, work[k])
    if any(k in out for k in ECGT_GROUP) and all(work.get(k) not in (None, "") for k in ECGT_GROUP):
        for k in ECGT_GROUP:
            out.setdefault(k, work[k])
    return out


def rules_for_client() -> dict:
    """Düzenleyicinin girişte kullandığı kurallar (tek kaynak bu modüldür): izin verilen karakter kümeleri (JS `u` bayrağıyla) ve sınırlar."""
    return {
        "title": {"max_len": TITLE_MAX, "allowed": r"\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®", "once_only": ONCE_ONLY},
        "tag": {"max_count": TAG_COUNT, "max_len": TAG_MAX_LEN, "allowed": r"\p{L}\p{Nd}\p{Zs}\-'™©®"},
        "material": {"max_count": MAX_MATERIALS, "allowed": r"\p{L}\p{Nd}\p{Zs}"},
        "style": {"max_count": MAX_STYLES, "max_len": MAX_STYLE_LEN, "allowed": r"\p{L}\p{Nd}\p{Zs}"},
        "alt_text_max": ALT_TEXT_MAX,
    }

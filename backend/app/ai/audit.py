"""Listing içerik denetçisi: bir listing'in içeriğini `standard`a göre okur, yapay zekâ ÇAĞIRMAZ (ücretsiz, deterministik).

Üç boyut, her biri farklı bir soruyu cevaplar:
- seo: Etsy aramasında eşleşir mi? (başlık, etiket, kategori, özellikler, mağazadaki diğer listing'lerle çakışma)
- aeo: Alıcının sorusuna doğrudan cevap veriyor mu? (açılış cümlesi, olgu listesi, soru-cevap, yeterli uzunluk)
- geo: Yapay zekâ asistanları güvenle önerebilir mi? (metin ve veri tutarlı, doğrulanabilir; malzeme, alt text, seçenekler, stok)

Kullandığı kuralların çoğu `quality`'dedir (üretim hattıyla AYNI denetimler); burada yalnızca açıklamanın yapısına bakan yeni kurallar vardır.
Her bulgunun `fix` alanı (attributes / description / title / tags / alt_text / None) ve `risk` değeri vardır: başlık değişikliği sıralamayı etkileyebilir (high),
açıklamaya ekleme ve özellik doldurma başlığa dokunmaz (low)."""
import html
import re
from dataclasses import asdict, dataclass

from app.ai import layout, quality, standard
from app.core.i18n import tr

DIMS = ("seo", "aeo", "geo")
_GREETING = re.compile(r"^\W*(welcome|hello|hi\b|hey|dear|thank|thanks|hoş\s?geldin|merhaba)", re.I)
_BULLET = re.compile(r"^\s*(?:[-•*➲✔✓☛▪►→]|\d+[.)])\s*\S")
_QUESTION = re.compile(r"^\s*(?:q\s*[:.)]|question\b|soru\s*[:.)])", re.I)
_PERSONAL = re.compile(r"personali[sz]|custom|engrav|monogram|your (?:name|text)|kişiselleştir|isim", re.I)


@dataclass
class Finding:
    id: str
    dim: str
    weight: int  # 2 = belirgin eksik, 1 = iyileştirme
    text: str
    fix: str | None  # attributes | description | title | tags | alt_text | None (elle)
    risk: str  # low | high: düzeltmenin sıralamayı bozma ihtimali


def _words(text: str) -> int:
    return len(text.split())


def _sentences(text: str) -> list[str]:
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    out: list[str] = []
    for ln in lines:
        if len(ln) <= 25 and not re.search(r"[.!?]$", ln) and not out:  # "☛ Description" gibi başlık satırı
            continue
        out += [p.strip() for p in re.split(r"(?<=[.!?])\s+", ln) if p.strip()]
    return out


def structure_issues(product: str, digital: bool = False) -> list[tuple[str, str]]:
    """Açıklamanın yapısı (AEO): [(kimlik, metin)]. Hem denetçi hem üretim hattı (yeniden deneme geri bildirimi) kullanır. `digital`: indirilebilir ürünün olguları farklıdır."""
    if not product.strip():
        return []
    out: list[tuple[str, str]] = []
    sentences = _sentences(product)
    opening = sentences[0] if sentences else ""
    if len(opening) < 40 or _GREETING.search(opening):
        out.append(("opening", tr(
            f"Açıklama ürünü ilk cümlede anlatmıyor; ilk {standard.OPENING_CHARS} karakter ürünün ne olduğunu, kimin için olduğunu ve en önemli özelliğini söylemeli.",
            f"The description does not say what the item is in the first sentence; the first {standard.OPENING_CHARS} characters should say what it is, who it is for and its key feature.",
        )))
    lines = product.split("\n")
    if sum(1 for ln in lines if _BULLET.match(ln)) < 3:
        out.append(("facts", tr(
            "Dosya türü, çözünürlük/boyut, kaç dosya ve nasıl indirilip kullanılacağı gibi olgular kısa maddeler halinde yok.",
            "Facts such as file type, resolution/size, number of files and how to download and use them are not listed as short bullets.",
        ) if digital else tr("Malzeme, ölçü, seçenekler gibi olgular kısa maddeler halinde yok.", "Facts such as material, size and options are not listed as short bullets.")))
    if sum(1 for ln in lines if _QUESTION.match(ln) or (ln.strip().endswith("?") and len(ln.strip()) < 140)) < 2:
        out.append(("faq", tr("Alıcının sorabileceği soruların kısa cevapları (soru-cevap) yok.", "There are no short answers to questions buyers ask (Q&A).")))
    if _words(product) > 120 and not any(layout.is_header(ln) for ln in lines):
        out.append(("layout_headers", tr("Açıklama tek blok; bölüm başlıkları (DETAILS, GREAT FOR…) ve boşluklarla düzenli değil.", "The description is one block; it is not organized with section headings and spacing.")))
    if len(re.findall(layout._EMOJI, product)) > 3:
        out.append(("layout_emoji", tr("Açıklamada çok fazla emoji var; düz ve temiz metin daha okunaklı.", "The description has too many emoji; plain, clean text reads better.")))
    if _words(product) < standard.DESCRIPTION_WORDS[0] // 2:
        out.append(("short", tr(f"Açıklama kısa ({_words(product)} kelime); alıcı niyetini karşılamak için daha dolu olmalı.", f"The description is short ({_words(product)} words); it should be fuller to meet buyer intent.")))
    return out


# Soru-cevap yapay zekâya zorlanmaz (veri yetmiyorsa atlanır; zorlamak uydurmaya iter); denetçide yine bulgu olarak görünür.
_NOT_ENFORCED = {"faq", "layout_headers", "layout_emoji"}


def generation_problems(
    title: str, tags: list[str], product_description: str, others: list[dict], source_text: str | None, variations: dict[str, list[str]], digital: bool = False,
) -> list[str]:
    """Yeni yazılan metin için TEK denetim: biçim ve benzersizlik (quality), uydurma (fact), açıklama yapısı. SEO öneri hattı ve sohbet asistanının
    taslak oluşturması aynısını kullanır; sorun varsa model geri bildirimle yeniden dener."""
    problems = quality.all_problems(title, tags, product_description, others, source_text, quality.size_options(variations))
    problems += quality.fact_problems(title, product_description, source_text or "", variations)
    problems += [text for id, text in structure_issues(quality.strip_common_paragraphs(product_description, others), digital) if id not in _NOT_ENFORCED]
    return problems


def summary(result: dict) -> dict:
    """Seviye özeti (yayın kaydında önce/sonra karşılaştırması için): genel seviye ve üç boyutun seviyesi."""
    return {"level": result["level"], **{d: result["dims"][d]["level"] for d in DIMS}}


def _level(points: int, weak_from: int = 3) -> str:
    return "good" if points == 0 else "mid" if points < weak_from else "weak"


def audit(listing: dict, *, variations: dict[str, list[str]], inventory: dict | None, missing_attributes: list[dict], others: list[dict]) -> dict:
    """`listing`: Etsy ham listing (title, tags, description, materials, images, taxonomy_id, state, is_personalizable);
    `missing_attributes`: boş kategori özellikleri [{"name", "required"}]; `others`: mağazanın diğer listing'leri (quality.shop_others)."""
    title = html.unescape(str(listing.get("title") or ""))
    tags = [html.unescape(str(t)) for t in listing.get("tags") or []]
    description = html.unescape(str(listing.get("description") or ""))
    product = quality.strip_common_paragraphs(description, others)
    f: list[Finding] = []

    def add(id: str, dim: str, weight: int, text: str, fix: str | None, risk: str = "low") -> None:
        f.append(Finding(id, dim, weight, text, fix, risk))

    # ---- SEO
    for i, p in enumerate(quality.title_problems(title, quality.size_options(variations))):
        add(f"title_{i}", "seo", 1, p, "title", "high")
    for i, p in enumerate(quality.tag_problems(tags)):
        add(f"tags_{i}", "seo", 2 if i == 0 and len(tags) != standard.TAG_COUNT else 1, p, "tags", "high")
    for i, p in enumerate(quality.brand_problems(title, tags)):
        add(f"brand_{i}", "seo", 2, p, "title", "high")
    if not listing.get("taxonomy_id"):
        add("no_category", "seo", 2, tr("Kategori seçilmemiş.", "No category selected."), None)
    required = [a["name"] for a in missing_attributes if a.get("required")]
    optional = [a["name"] for a in missing_attributes if not a.get("required")]
    if required:
        add("attrs_required", "seo", 2, tr(f"Zorunlu özellikler boş: {', '.join(required[:5])}.", f"Required attributes are empty: {', '.join(required[:5])}."), "attributes")
    if optional:
        add("attrs_empty", "seo", 1, tr(f"{len(optional)} kategori özelliği boş ({', '.join(optional[:4])}…); Etsy aramasında ve filtrelerde eşleşme kaçıyor.", f"{len(optional)} category attributes are empty ({', '.join(optional[:4])}…); you miss search and filter matches."), "attributes")
    conflicts = quality.conflicts(title, tags, product, others)
    if conflicts:
        add("conflict", "seo", 1, tr(
            f"Mağazadaki \"{conflicts[0]['title'][:50]}\" listing'iyle aynı aramalarda yarışıyor (benzer başlık/etiket/açılış).",
            f"It competes in the same searches as \"{conflicts[0]['title'][:50]}\" (similar title/tags/opening).",
        ), None)

    # ---- AEO
    if not product.strip():
        add("no_description", "aeo", 2, tr("Ürüne özel açıklama yok.", "There is no product-specific description."), "description")
    for id, text in structure_issues(product, listing.get("listing_type") == "download"):
        add(id, "aeo", 1, text, "description")

    # ---- GEO
    source = "\n".join([title, description, " ".join(map(str, listing.get("materials") or [])), " ".join(v for vals in variations.values() for v in vals)])
    for i, p in enumerate(quality.fact_problems(title, description, source, variations)):
        add(f"fact_{i}", "geo", 2, p, "description")
    for i, p in enumerate(quality.claim_problems(product)):
        add(f"claim_{i}", "geo", 2, p, "description")
    if listing.get("is_personalizable") and product.strip() and not _PERSONAL.search(product):
        add("personalization", "geo", 1, tr("Kişiselleştirilebilir ama açıklama bunun nasıl yapıldığını anlatmıyor.", "The item is personalizable but the description does not explain how."), "description")
    unlisted = [n for n, vals in variations.items() if 2 <= len(vals) <= 12 and not any(re.search(rf"\b{re.escape(v.lower())}\b", description.lower()) for v in vals)]
    if unlisted and product.strip():
        add("options", "geo", 1, tr(f"Açıklama seçenekleri ({', '.join(unlisted)}) saymıyor; yapay zekâ asistanları seçenekleri açıklamadan okur.", f"The description does not list the options ({', '.join(unlisted)}); AI assistants read options from the description."), "description")
    images = listing.get("images") or []
    no_alt = [i for i in images if not (i.get("alt_text") or "").strip()]
    if no_alt:
        add("alt_text", "geo", 1, tr(f"{len(no_alt)}/{len(images)} fotoğrafın alt metni yok.", f"{len(no_alt)}/{len(images)} photos have no alt text."), "alt_text")
    if listing.get("listing_type") != "download" and not listing.get("materials"):
        add("materials", "geo", 1, tr("Malzeme alanı boş.", "The materials field is empty."), None)
    offers = [o for p in (inventory or {}).get("products", []) for o in p.get("offerings", []) if o.get("is_enabled", True)]
    if listing.get("state") == "active" and offers and not any((o.get("quantity") or 0) > 0 for o in offers):
        add("no_stock", "geo", 2, tr("Listing aktif ama hiçbir seçeneğin stoğu yok.", "The listing is active but no option has stock."), None)

    points = {d: sum(x.weight for x in f if x.dim == d) for d in DIMS}
    dims = {d: {"level": _level(points[d]), "points": points[d], "count": sum(1 for x in f if x.dim == d)} for d in DIMS}
    order = {"weak": 2, "mid": 1, "good": 0}
    overall = max((v["level"] for v in dims.values()), key=lambda lv: order[lv])
    return {"level": overall, "dims": dims, "findings": [asdict(x) for x in sorted(f, key=lambda x: -x.weight)]}

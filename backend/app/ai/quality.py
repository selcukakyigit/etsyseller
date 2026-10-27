"""Listing metni için ortak kalite ve benzersizlik denetimleri (AI önerisi ve sohbet asistanı aynı kuralları kullanır).

Amaç: aynı mağazadaki benzer ürünlerin (ör. 20 farklı çiftlik tabelası) başlık, etiket ve açıklamalarının birbirinin
kopyası olmaması; her listing kendi uzun kuyruklu anahtar kelimelerini hedeflesin, mağaza kendi kendisiyle rekabet etmesin."""
import html
import json
import re

from app.ai.standard import MAX_SHARED_TAGS, TAG_COUNT, TAG_MAX_LEN, TITLE_MAX_CHARS, TITLE_MAX_WORDS, TITLE_MIN_CHARS
from app.core.i18n import tr
from app.listings import etsy_rules

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.listings.models import ListingCache

MAX_TITLE_SIMILARITY = 0.6  # başlık kelime kümesi benzerliği (Jaccard)
MAX_INTRO_SIMILARITY = 0.6  # açıklamanın ilk ~60 kelimesinin benzerliği

_WORD = re.compile(r"[^\W_]+")  # her dildeki harf ve rakamlar (ä, ß, é, ç, ğ…)
_STOP = {"the", "and", "for", "with", "your", "our", "you", "from", "this", "that", "a", "an", "of", "in", "to", "or", "by", "on", "at", "is", "it"}
RISKY_CLAIMS = re.compile(
    r"\b(hardware (?:is |are )?(?:included|provided)|(?:included|free) hardware|warranty|lifetime|(?:water|weather|rust|fade|scratch|uv)[- ]?(?:proof|resistant)|certified|fireproof|hypoallergenic|"
    r"uv ?(?:400|protect\w*|block\w*|filter\w*)|polari[sz]ed|anti[- ]glare|(?:100%|full) protection|outdoors?|durab\w+|long[- ]lasting)\b", re.I
)


# Etsy'de telif/marka ihlali sayılan, en sık görülen karakter ve marka adları: başlıkta/etiketlerde geçerse listing kaldırılabilir,
# tekrarında hesap kısıtlanabilir. Kısa, bilerek temkinli bir liste (tam bir marka denetimi değildir); lisansı olan satıcı
# düzenleyicide elle yazabilir.
_COLOR_WORDS = {"black", "white", "red", "yellow", "grey", "gray", "blue", "green", "gold", "silver", "pink", "purple", "orange", "brown", "beige", "navy"}

PROTECTED_NAMES = re.compile(
    r"\b(spider[- ]?man|marvel|avengers|iron man|captain america|batman|superman|dc comics|wonder woman|disney|mickey mouse|"
    r"pixar|star wars|mandalorian|baby yoda|harry potter|hogwarts|pokemon|pok[eé]mon|pikachu|nintendo|super mario|zelda|minecraft|"
    r"hello kitty|sanrio|barbie|lego|stranger things|game of thrones|lord of the rings|naruto|one piece|dragon ball|"
    r"nike|adidas|gucci|louis vuitton|chanel|rolex|coca[- ]?cola|harley[- ]?davidson|taylor swift|nfl|nba|mlb|"
    r"apple watch|iphone|ipad|macbook|airpods|samsung galaxy|playstation|xbox|tesla|ikea|starbucks)\b", re.I
)


def _words(text: str) -> set[str]:
    return {w for w in (m.lower() for m in _WORD.findall(text)) if w not in _STOP and len(w) > 1}


def _jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def clean_tags(tags: list[str]) -> list[str]:
    out, seen = [], set()
    for t in tags:
        t = etsy_rules.clean_tag(t)  # Etsy: yalnızca harf, rakam, boşluk, - ve ' (ör. "metal sign!" → "metal sign")
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def fix_long_tags(tags: list[str]) -> list[str]:
    """20 karakteri aşan etiketi sondan kelime atarak kısaltır (Etsy reddeder); çok kelimeli anlamını olabildiğince korur.
    Kısaltma tek kelimeye düşecekse ya da mevcut bir etiketle aynı olacaksa etiketi kesmeden bırakır (sorun olarak raporlanır)."""
    out: list[str] = []
    have = {t.lower() for t in tags if len(t) <= TAG_MAX_LEN}
    for t in tags:
        if len(t) > TAG_MAX_LEN:
            words = t.split()
            while len(words) > 2 and len(" ".join(words)) > TAG_MAX_LEN:
                words.pop()
            short = " ".join(words)
            if len(short) <= TAG_MAX_LEN and short.lower() not in have:
                have.add(short.lower())
                out.append(short)
                continue
        out.append(t)
    return out


# Etsy'nin Ağustos 2025 başlık rehberi: başlık kısa ve net (15 kelimeden az), önce ürünün ne olduğu, sonra renk/boyut/
# malzeme gibi nesnel tanımlar. Hediye/alıcı ifadeleri ve öznel sözcükler etiketlere, özelliklere ve açıklamaya taşınır;
# kargo/indirim bilgisi ve kelime tekrarı başlıkta olmaz.
_GIFT = re.compile(r"\b(gifts?|for (?:him|her|them|mom|mum|dad|men|women|kids|teens|wife|husband|boyfriend|girlfriend|grandma|grandpa|friends?))\b", re.I)
_SUBJECTIVE = re.compile(r"\b(beautiful|perfect|best|amazing|stunning|cute|lovely|unique|awesome|gorgeous|must[- ]have)\b", re.I)
_PROMO = re.compile(r"(free shipping|fast shipping|on sale|\bsale\b|discount|%\s*off|\boff\b\s*\d)", re.I)
# Kişiselleştirme sözcükleri: listing'de kişiselleştirme sorusu yokken başlık/etiket/açıklamada geçerse alıcıyı yanıltır.
PERSONALIZATION = re.compile(r"personali[sz]|\bcustom (?:name|text|initials?)\b|\bengrav|\bmonogram|\byour name\b|\binitials?\b|\bname or initials\b", re.I)


def personalization_mentions(title: str, tags: list[str], description: str) -> list[str]:
    """Kişiselleştirmeden söz eden yerler: "title", "tags", "description" (hiçbiri yoksa boş)."""
    return [name for name, text in (("title", title), ("tags", " | ".join(tags)), ("description", description)) if PERSONALIZATION.search(text or "")]


def without_personalization_tags(tags: list[str]) -> list[str]:
    """Kişiselleştirme kapatıldığında anlamsızlaşan etiketler çıkarılır (ör. "personalized shades", "custom initials")."""
    return [t for t in tags if not PERSONALIZATION.search(t)]


def title_problems(title: str, sizes_vary: bool = True) -> list[str]:
    """Başlığın Etsy'nin güncel başlık rehberine uyumu. `sizes_vary`: listing'de birden çok ölçü seçeneği var (ya da
    bilinmiyor); öyleyse başlıktaki ölçü sorundur. Tek, sabit ölçülü üründe (11 oz kupa, 8x10 baskı) ölçü aranan bir
    özelliktir ve başlıkta kalabilir."""
    out: list[str] = []
    words = [w for w in re.split(r"[\s,|/–—-]+", title.strip()) if w]
    if len(title) > TITLE_MAX_CHARS:
        out.append(tr(f"Başlık {len(title)} karakter; en fazla {TITLE_MAX_CHARS} olabilir.", f"The title is {len(title)} characters; the limit is {TITLE_MAX_CHARS}."))
    if len(words) > TITLE_MAX_WORDS:
        out.append(tr(
            f"Başlık {len(words)} kelime; en fazla {TITLE_MAX_WORDS} olsun. Önce ürünün ne olduğunu, sonra malzeme/stil/kullanım yerini yaz; tekrarları at, gerisini etiketlere ve açıklamaya taşı.",
            f"The title has {len(words)} words; keep it to {TITLE_MAX_WORDS} at most. Say what the item is first, then material/style/use; drop repeats and move the rest to tags and the description.",
        ))
    if len(title.strip()) < TITLE_MIN_CHARS:
        out.append(tr(
            "Başlık çok kısa; ürünün ne olduğunu ve en az bir nesnel tanımı (malzeme, boyut ya da renk) yaz.",
            "The title is too short; say what the item is and add at least one objective detail (material, size or color).",
        ))
    gift = sorted({m.group(0).lower() for m in _GIFT.finditer(title)})
    if gift:
        out.append(tr(
            f"Başlıkta hediye/alıcı ifadesi var ({', '.join(gift)}); Etsy bunları etiketlere ve özelliklere taşımayı öneriyor.",
            f"The title has gift/recipient wording ({', '.join(gift)}); Etsy recommends moving it to tags and attributes.",
        ))
    subjective = sorted({m.group(0).lower() for m in _SUBJECTIVE.finditer(title)})
    if subjective:
        out.append(tr(
            f"Başlıkta öznel sözcük var ({', '.join(subjective)}); başlıkta yalnızca nesnel tanımlar olsun.",
            f"The title has subjective words ({', '.join(subjective)}); keep the title to objective details.",
        ))
    if sizes_vary and _SIZE.search(title):
        out.append(tr(
            "Başlıkta ölçü var ama listing'de birden çok ölçü seçeneği var; başlığa tek bir ölçü yazılmaz, ölçüler varyasyonlarda ve açıklamada.",
            "The title contains a size although the listing offers several sizes; do not put a single size in the title, sizes belong in the variations and description.",
        ))
    if _PROMO.search(title):
        out.append(tr("Başlıkta kargo/indirim bilgisi var; bu bilgi başlıkta olmamalı.", "The title mentions shipping or a discount; that does not belong in the title."))
    counts: dict[str, int] = {}
    for w in (m.lower() for m in _WORD.findall(title)):
        if w not in _STOP and len(w) > 2:
            counts[w] = counts.get(w, 0) + 1
    repeated = sorted(w for w, n in counts.items() if n > 1)
    if repeated:
        out.append(tr(
            f"Başlıkta tekrar eden kelime var ({', '.join(repeated)}); her kelimeyi bir kez kullan, eş anlamlıları etiketlere koy.",
            f"The title repeats words ({', '.join(repeated)}); use each word once and put synonyms in the tags.",
        ))
    return out


_SIZE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:\"|”|''|in\b|inch(?:es)?\b|cm\b|mm\b|ft\b|feet\b|foot\b)", re.I)
_NUM = re.compile(r"\d+(?:[.,]\d+)?")
COLORS = (
    "black", "white", "gold", "silver", "grey", "gray", "copper", "bronze", "brown", "red", "blue", "green", "yellow",
    "orange", "pink", "purple", "beige", "navy", "teal", "ivory", "cream", "rose gold", "antique",
)


_TR_COLORS = {
    "siyah": "black", "beyaz": "white", "altın": "gold", "gümüş": "silver", "gri": "grey", "bakır": "copper", "bronz": "bronze", "kahverengi": "brown",
    "kırmızı": "red", "mavi": "blue", "yeşil": "green", "sarı": "yellow", "turuncu": "orange", "pembe": "pink", "mor": "purple", "bej": "beige", "lacivert": "navy",
    "krem": "cream", "gökkuşağı": "rainbow",
}


def _with_conversions(nums: set[str]) -> set[str]:
    """Kaynaktaki ölçülerin cm↔inç karşılıkları (35 cm → 13.8 in) uydurma sayılmaz."""
    out = set(nums)
    for n in nums:
        try:
            v = float(n)
        except ValueError:
            continue
        for c in (v / 2.54, v * 2.54):
            for shown in (c, c - 0.1, c + 0.1):
                out.add(f"{shown:.1f}")
            out.update({f"{c:.0f}", f"{c:g}"})
    return out


_FILLER = re.compile(
    r"\b(?:see (?:the )?variations?|(?:are|is) (?:set|listed|shown) (?:as|in) (?:the )?(?:product )?variations?|choose (?:it )?from the (?:size|color|colour|option)s? (?:menu|dropdown)|"
    r"(?:prices?|stock)(?: and (?:stock|prices?))? (?:per \w+ )?(?:are|is) listed in the variations?|select your (?:size|option) (?:from|in) the (?:menu|dropdown))\b", re.I)
_EVASIVE_ANSWER = re.compile(r"\b(?:please |feel free to )?(?:ask|contact|message|write to) us\b|\bplease ask\b|\b(?:up)?on request\b", re.I)
_PERSONAL_LINE = re.compile(r"personali[sz]|engrav|your name|name or (?:short )?text|custom name", re.I)


def filler_problems(description: str) -> list[str]:
    """Açıklamanın dolgu ve tekrar sorunları: "varyasyonlara bakın" gibi bilgi vermeyen cümleler; aynı konunun (kişiselleştirme) 3+ satırda anlatılması."""
    out: list[str] = []
    if _FILLER.search(description):
        out.append(tr(
            "Açıklamada \"varyasyonlara bakın / seçenekler varyasyon olarak ayarlı\" gibi bilgi vermeyen dolgu cümle var; seçenekleri adıyla say (ör. \"Sizes: 50 cm, 70 cm\"), dolgu yazma.",
            "The description has filler such as \"see variations\"; list the options by name (e.g. \"Sizes: 50 cm, 70 cm\") instead.",
        ))
    qa = re.split(r"^QUESTIONS\s*$", description, maxsplit=1, flags=re.M)
    if len(qa) == 2 and _EVASIVE_ANSWER.search(qa[1].split("\n\n\n")[0]):
        out.append(tr(
            "Soru-cevap bölümünde bilgi vermeyen cevap var (\"bize sorun / istek üzerine\"); cevabı bilinmeyen soruyu SİL, yalnızca cevabı bilinen olguyu yaz.",
            "A Q&A answer gives no information (\"ask us / on request\"); delete questions whose answer is unknown and write only known facts.",
        ))
    lines = [ln for ln in description.split("\n") if ln.strip() and not ln.strip()[0] in "☛➲✔✓ツ"]
    if sum(1 for ln in lines if _PERSONAL_LINE.search(ln)) >= 3:
        out.append(tr(
            "Kişiselleştirme 3 ya da daha fazla yerde anlatılmış; bir kez (OLGULAR'da) anlat, açılışta kısaca anıp soru-cevapta ve diğer bölümlerde tekrar etme.",
            "Personalization is explained in 3+ places; explain it once (in DETAILS) and do not repeat it in the Q&A or other sections.",
        ))
    return out


_SIZE_NAME = re.compile(r"size|boyut|ölçü|olcu|dimension|length|width|height|diameter|größe|taille|tamaño", re.I)


def size_options(variations: dict[str, list[str]]) -> bool:
    """Listing'de birden çok seçenekli bir ölçü varyasyonu var mı (adından ya da seçeneklerinin ölçü biçiminden)."""
    for name, vals in variations.items():
        if len(vals) >= 2 and (_SIZE_NAME.search(name) or sum(1 for v in vals if _SIZE.search(v)) >= 2):
            return True
    return False


def variation_values(inventory: dict | None) -> dict[str, list[str]]:
    """Envanterdeki varyasyonlar: özellik adı -> seçenekler (Etsy'nin HTML kaçışları çözülmüş)."""
    out: dict[str, list[str]] = {}
    for p in (inventory or {}).get("products") or []:
        for pv in p.get("property_values") or []:
            name = html.unescape(str(pv.get("property_name") or "")).strip()
            if not name:
                continue
            vals = out.setdefault(name, [])
            for v in pv.get("values") or []:
                v = html.unescape(str(v)).strip()
                if v and v not in vals:
                    vals.append(v)
    return out


def _in_title(value: str, title_lower: str) -> bool:
    """Seçenek başlıkta ayrı bir sözcük olarak geçiyor mu. Beden harfleri (S, M, L) ve çok kısa değerler sayılmaz: "Papa's" gibi sözcüklerin içinde eşleşirdi."""
    v = value.strip().lower()
    if len(v) <= 2 and not any(ch.isdigit() for ch in v):
        return False
    return bool(re.search(rf"(?<![\w'’]){re.escape(v)}(?![\w'’])", title_lower))


def fact_problems(title: str, description: str, source_text: str, variations: dict[str, list[str]]) -> list[str]:
    """Önerinin listing'de olmayan bilgi uydurmadığını denetler: kaynakta geçmeyen ölçü ve renkler; birden çok seçeneği
    olan boyut/renk için başlıkta tek bir seçenek (alıcıyı yanıltır)."""
    out: list[str] = []
    src = html.unescape(source_text).lower()
    src += " " + " ".join(en for tr_word, en in _TR_COLORS.items() if tr_word in src)  # kaynak Türkçeyse ("siyah") İngilizce karşılığı da bilinen renktir
    src_nums = _with_conversions({n.replace(",", ".") for n in _NUM.findall(src)})
    new_text = f"{title}\n{description}"
    sizes = sorted({m.group(1).replace(",", ".") for m in _SIZE.finditer(new_text)} - src_nums)
    if sizes:
        out.append(tr(
            f"Listing'de olmayan ölçü yazılmış ({', '.join(sizes)}); yalnızca listing'deki ölçüleri kullan, ölçü uydurma.",
            f"Sizes that are not in the listing were written ({', '.join(sizes)}); use only the listing's sizes.",
        ))
    low = new_text.lower()
    colors = sorted(c for c in COLORS if re.search(rf"\b{c}\b", low) and not re.search(rf"\b{c}\b", src))
    if colors:
        out.append(tr(
            f"Listing'de olmayan renk yazılmış ({', '.join(colors)}); yalnızca listing'deki renkleri kullan.",
            f"Colors that are not in the listing were written ({', '.join(colors)}); use only the listing's colors.",
        ))
    d = description.lower()
    for name, vals in variations.items():
        if len(vals) < 2 or not any(k in name.lower() for k in ("color", "colour", "renk")):
            continue
        listed = [v for v in vals if re.search(rf"\b{re.escape(v.lower())}\b", d)]
        missing = [v for v in vals if v not in listed]
        if len(listed) >= 2 and missing:
            out.append(tr(
                f"Açıklamadaki renk listesi eksik ({', '.join(missing)} yok); varyasyonlardaki tüm renkleri yaz: {', '.join(vals)}.",
                f"The color list in the description is incomplete ({', '.join(missing)} missing); list every color offered: {', '.join(vals)}.",
            ))
    t = title.lower()
    for name, vals in variations.items():
        if len(vals) < 2:
            continue
        hits = [v for v in vals if _in_title(v, t) or any(n in _NUM.findall(t) for n in _NUM.findall(v))]
        if hits:
            out.append(tr(
                f"Başlıkta \"{name}\" seçeneklerinden yalnızca biri var ({hits[0]}), oysa {len(vals)} seçenek sunuluyor; başlığa tek bir seçeneği yazma.",
                f"The title names only one of the \"{name}\" options ({hits[0]}) although {len(vals)} are offered; do not put a single option in the title.",
            ))
    return out


def clean_title(title: str, variations: dict[str, list[str]]) -> str:
    """Model denemelere rağmen başlığa (listing'de birden çok ölçü seçeneği varken) ölçü ya da birden çok seçeneği olan
    bir varyasyonun tek değerini yazdıysa onu başlıktan çıkarır; kalan noktalama toparlanır. Tek ölçülü üründe ölçü kalır."""
    t = _SIZE.sub("", title) if size_options(variations) else title
    for vals in variations.values():
        if len(vals) < 2:
            continue
        for v in vals:
            word = re.sub(r"[^\w\s'&-]", "", v).strip()
            if len(word) > 2 and not any(ch.isdigit() for ch in word):  # beden harfleri (S, M, L) silinmez: "Papa's" bozulurdu
                t = re.sub(rf"(?i)(?<![\w'’])(?:in\s+)?{re.escape(word)}(?![\w'’])", "", t)
    t = re.sub(r"\s+,", ",", t)
    t = re.sub(r",\s*,+", ",", t)
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip(" ,-–|/")


_AUDIENCE_FORMS = {"mens": "men", "man": "men", "womens": "women", "woman": "women", "kids": "kid", "childrens": "kid", "children": "kid"}


def tag_key(tag: str) -> str:
    """Etiketin "aynı arama" anahtarı: tekil/çoğul, iyelik ve kitle varyantları aynı sayılır ("mens sunglasses" = "men sunglasses",
    "womens" = "women"); kelime sırası önemsizdir."""
    out = []
    for w in re.findall(r"[a-z0-9]+", tag.lower().replace("'", "")):
        w = _AUDIENCE_FORMS.get(w, w)
        out.append(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w)
    return " ".join(sorted(out))


def near_duplicate_tags(tags: list[str]) -> list[list[str]]:
    groups: dict[str, list[str]] = {}
    for t in tags:
        groups.setdefault(tag_key(t), []).append(t)
    return [g for g in groups.values() if len(g) > 1]


def tag_problems(tags: list[str]) -> list[str]:
    out: list[str] = []
    if len(tags) != TAG_COUNT:
        out.append(tr(f"{len(tags)} etiket var; tam {TAG_COUNT} olmalı.", f"There are {len(tags)} tags; there must be exactly {TAG_COUNT}."))
    long_tags = [t for t in tags if len(t) > TAG_MAX_LEN]
    if long_tags:
        out.append(tr(f"Etiketler en fazla {TAG_MAX_LEN} karakter olabilir: {', '.join(long_tags)}.", f"Tags can be at most {TAG_MAX_LEN} characters: {', '.join(long_tags)}."))
    colorful = [t for t in tags if len({w for w in re.findall(r"[a-z]+", t.lower())} & _COLOR_WORDS) >= 2]
    if colorful:
        out.append(tr(
            f"Etiket renk listesi gibi ({', '.join(colorful)}); renkler varyasyonda zaten var, arama ifadesi olan bir etiketle değiştir.",
            f"A tag reads like a color list ({', '.join(colorful)}); colors are already variations, replace it with a search phrase.",
        ))
    twins = near_duplicate_tags(tags)
    if twins:
        out.append(tr(
            f"Birbirinin neredeyse aynısı etiketler var ({'; '.join(' = '.join(g) for g in twins)}); aynı aramayı iki kez kullanma, birini farklı bir alıcı niyetiyle değiştir.",
            f"Some tags are near-duplicates ({'; '.join(' = '.join(g) for g in twins)}); do not spend two tags on the same search, replace one with a different buyer intent.",
        ))
    single = [t for t in tags if " " not in t]
    if len(single) > 3:
        out.append(tr(
            f"{len(single)} etiket tek kelime ({', '.join(single)}); 2–4 kelimelik uzun kuyruklu etiketler kullan.",
            f"{len(single)} tags are single words ({', '.join(single)}); use 2–4 word long-tail tags.",
        ))
    return out


def _unverified_claims(text: str, source_text: str | None) -> list[str]:
    src = html.unescape(source_text or "").lower()
    return sorted({c for c in (m.group(0).lower() for m in RISKY_CLAIMS.finditer(text)) if not re.search(rf"\b{re.escape(c)}\b", src)})


def strip_claims(description: str, source_text: str | None = None) -> str:
    """Model yeniden denemelerde de bırakmadıysa doğrulanmamış iddia geçen cümleyi (madde satırıysa satırı) açıklamadan siler;
    `clean_title`in açıklama karşılığı. Kaynakta (listing'in mevcut metni) geçen iddialara dokunmaz."""
    out: list[str] = []
    for line in description.split("\n"):
        if not _unverified_claims(line, source_text):
            out.append(line)
            continue
        sentences = re.split(r"(?<=[.!?])\s+", line)
        kept = [s for s in sentences if not _unverified_claims(s, source_text)]
        if len(sentences) > 1 and kept:
            out.append(" ".join(kept))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def claim_problems(product_description: str, source_text: str | None = None) -> list[str]:
    """Doğrulanmamış iddialar. `source_text` (listing'in mevcut metni) verilirse, orada zaten geçenler (ör. su geçirmez bir çantada "waterproof") sorun sayılmaz."""
    claims = _unverified_claims(product_description, source_text)
    if not claims:
        return []
    return [tr(
        f"Açıklamada doğrulanmamış iddialar var ({', '.join(claims)}); bu ifadeleri (soru-cevap dahil) açıklamadan SİL, yalnızca kullanıcının verdiği ya da görselde görünen bilgiyi yaz.",
        f"The description has unverified claims ({', '.join(claims)}); REMOVE these phrases (including in Q&A) and write only what the seller stated or what the photos show.",
    )]


# "metal" demiş kullanıcının ürününe "steel" yazılamaz: genel malzeme adı özgül olandan (çelik, pirinç, meşe…) ayrılır; özgül olan kaynakta geçmiyorsa uydurmadır.
SPECIFIC_MATERIALS = {
    "steel", "stainless", "iron", "aluminum", "aluminium", "brass", "copper", "bronze", "tin", "zinc", "titanium",
    "oak", "walnut", "pine", "maple", "birch", "bamboo", "plywood", "mdf", "cherry",
    "porcelain", "stoneware", "cotton", "linen", "wool", "velvet", "suede", "acrylic", "resin", "silicone",
}
# Kullanıcı malzemeyi Türkçe yazar ("aluminyumdan"); İngilizce karşılığı "söylenmemiş malzeme" sayılmaz.
_TR_MATERIALS = {
    "aluminyum": "aluminum", "alüminyum": "aluminum", "çelik": "steel", "paslanmaz": "stainless", "bakır": "copper", "pirinç": "brass", "demir": "iron", "bronz": "bronze", "titanyum": "titanium",
    "meşe": "oak", "ceviz": "walnut", "bambu": "bamboo", "çam": "pine", "huş": "birch", "pamuk": "cotton", "keten": "linen", "yün": "wool", "kadife": "velvet", "süet": "suede",
    "akrilik": "acrylic", "reçine": "resin", "silikon": "silicone", "porselen": "porcelain",
}


def tr_material_words(text: str) -> set[str]:
    """Metindeki Türkçe malzeme adlarının İngilizce karşılıkları (kaynak kontrolünde 'söylenmiş' sayılır)."""
    low = html.unescape(text or "").lower()
    return {en for tr_word, en in _TR_MATERIALS.items() if tr_word in low}


_METHOD_CLAIM = re.compile(r"\b(?:laser|cnc|hand)[- ]?(?:cut|crafted|machined)\b|\bhand[- ]?made\b", re.IGNORECASE)
_METHOD_STATED = re.compile(r"laser|lazer|cnc|hand ?made|handcraft|el yap[ıi]m|el i[sş]i|kesim|kesil", re.IGNORECASE)


_HEADER = re.compile(r"[A-Z][A-Z &/-]{2,30}")


def drop_empty_sections(description: str) -> str:
    """İçi boşalmış bölüm başlıkları ("QUESTIONS" altındaki tek madde iddia diye silinince) açıklamadan çıkarılır."""
    lines = description.split("\n")
    out: list[str] = []
    for i, line in enumerate(lines):
        if _HEADER.fullmatch(line.strip()):
            nxt = next((x for x in lines[i + 1:] if x.strip()), "")
            if not nxt or _HEADER.fullmatch(nxt.strip()):
                continue
        out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


_REDUNDANT_Q = re.compile(r"^[ \t]*[•*-][ \t]*(?:what|which|how many)\b[^?\n]*\b(?:sizes?|colou?rs?|options?|finish(?:es)?|available)\b[^?\n]*\?|^[ \t]*[•*-][ \t]*can (?:i|you) (?:choose|pick|select)\b[^?\n]*\?", re.I | re.M)


def drop_redundant_qa(description: str) -> str:
    """QUESTIONS bölümünde yalnızca DETAILS'i tekrar eden soru-cevaplar (hangi boyutlar / renk seçebilir miyim) silinir; yeni bilgi veren sorulara dokunulmaz."""
    lines = description.split("\n")
    return "\n".join(line for line in lines if not _REDUNDANT_Q.match(line))


_NOT_A_FACT = re.compile(r"\$|\busd\b|\bprices?\b|\bstock\b|\bquantity\b|\bunits\b|\bin stock\b|\bshipping\b", re.I)


def build_details(description: str, variations: dict[str, list[str]], materials: list[str] | None, personalization: str = "") -> str:
    """DETAILS bölümü: modelin yazdığı madde satırlarından fiyat/stok/kargo satırları ve tekrarlar atılır, eksik olgular (seçenekler, malzeme, kişiselleştirme) varyasyonlardan eklenir.
    Açıklamada fiyat ve stok olmaz: ikisi de değişir ve zaten varyasyonlarda durur. Madde yoksa boş döner."""
    lines: list[str] = []
    seen_labels: set[str] = set()
    for line in description.split("\n"):
        m = re.match(r"^[ \t]*[•*-][ \t]*([^:\n]{2,40}):[ \t]*(.+)$", line)
        if not m or _NOT_A_FACT.search(line):
            continue
        label = re.sub(r"[^a-z]", "", m.group(1).lower())
        label = "size" if label.startswith("size") else "color" if label.startswith(("color", "colour")) else label
        if label in seen_labels:
            continue
        seen_labels.add(label)
        lines.append(f"• {m.group(1).strip()}: {m.group(2).strip()}")
    body = "\n".join(lines)
    out = add_missing_facts(("DETAILS\n" + body) if body else "", variations, materials)
    if personalization and "personali" not in out.lower():
        out = (out + "\n" if out else "DETAILS\n") + f"• Personalization: {personalization}"
    return out.strip()


def neutralize_method_claims(description: str, source_text: str | None) -> str:
    """Kullanıcının söylemediği üretim yöntemi sözcükleri ("laser-cut", "handmade") açıklamada nötrleştirilir ("cut", "made"): cümle ve açılış korunur, uydurma iddia kalmaz."""
    if _METHOD_STATED.search(html.unescape(source_text or "")):
        return description
    return _METHOD_CLAIM.sub(lambda m: "made" if "made" in m.group(0).lower() else "cut", description)


def add_missing_facts(description: str, variations: dict[str, list[str]], materials: list[str] | None = None) -> str:
    """Açıklama seçenekleri (boyut, renk…) ve malzemeyi adıyla saymıyorsa DETAILS bölümüne sunucu ekler: veri varyasyonlardan ve kullanıcının verdiği alanlardan gelir, uydurma yok.
    Zaten geçen seçenek tekrar yazılmaz; hiçbiri eksik değilse açıklamaya dokunulmaz."""
    low = description.lower()
    lines = []
    for name, values in variations.items():
        values = [v for v in values if v]
        if 2 <= len(values) <= 12 and not any(re.search(rf"(?<![a-z0-9]){re.escape(v.lower())}(?![a-z0-9])", low) for v in values):
            lines.append(f"• {name.split('(')[0].strip().capitalize()}s: {', '.join(values)}" if name.lower() in ("size", "color", "colour") else f"• {name}: {', '.join(values)}")
    mats = [m for m in (materials or []) if m and m.lower() not in low]
    if mats:
        lines.append(f"• Material: {', '.join(mats)}")
    if not lines:
        return description
    if re.search(r"^DETAILS\s*$", description, re.M):
        return re.sub(r"^(DETAILS\s*\n)", lambda m: m.group(1) + "\n".join(lines) + "\n", description, count=1, flags=re.M)
    return description.rstrip() + "\n\nDETAILS\n" + "\n".join(lines)


_TURKISH_ONLY = re.compile(r"[ğĞıİşŞ]")  # ç, ö, ü başka dillerde de var (marka/yer adları); bu harfler yalnızca Türkçe'dedir


def material_problems(text: str, source_text: str | None = None) -> list[str]:
    """Başlık/etiket/açıklama/malzeme alanında kaynakta olmayan özgül malzeme (kullanıcı yalnızca "metal" dediyse "steel")."""
    src = html.unescape(source_text or "").lower() + " " + " ".join(tr_material_words(source_text or ""))
    found = sorted({w for w in _WORD.findall(text.lower()) if w in SPECIFIC_MATERIALS and not re.search(rf"\b{re.escape(w)}", src)})
    if not found:
        return []
    return [tr(
        f"Kullanıcının söylemediği özgül malzeme yazılmış ({', '.join(found)}); yalnızca kullanıcının dediği malzemeyi yaz (ör. 'metal'), başlıktan, etiketlerden, açıklamadan ve malzeme alanından çıkar.",
        f"A specific material the seller did not state was written ({', '.join(found)}); write only the stated material (e.g. 'metal') in the title, tags, description and materials.",
    )]


_TURKISH_WORDS = {
    "ile", "için", "ve", "bir", "olarak", "veya", "değil", "gibi", "kadar", "edilir", "monte", "çivi", "vida", "ürün", "duvar", "siyah", "beyaz", "gri", "altın", "kahverengi",
    "dekor", "kullanılır", "kullanılabilir", "dış", "mekan", "mekân", "yok", "var", "boyut", "adet", "renk",
}


def language_problems(text: str) -> list[str]:
    """Etsy metni İngilizce yazılır; kullanıcının Türkçe sözü olduğu gibi kopyalanmışsa (ör. "çivi ile monte edilir") çevrilmeli."""
    hits = sorted({w for w in _WORD.findall(text.lower()) if w in _TURKISH_WORDS or _TURKISH_ONLY.search(w)})
    if not hits:
        return []
    return [tr(
        f"Metinde Türkçe sözcükler var ({', '.join(hits[:4])}); başlık, etiket ve açıklamayı İngilizceye çevir.",
        f"The text contains Turkish words ({', '.join(hits[:4])}); translate the title, tags and description into English.",
    )]


_SIZE_TOKEN = re.compile(r"[0-9]+(?:[.,][0-9]+)?[ ]*[x×][ ]*[0-9]+(?:[.,][0-9]+)?(?:[ ]*[x×][ ]*[0-9]+(?:[.,][0-9]+)?)?[ ]*(?:cm|mm|inches|inch|in|ft|m|\")?(?:[ ]*[(][^)]*[)])?", re.IGNORECASE)
_SINGLE_SIZE = re.compile(r"(?<![A-Za-z0-9])[0-9]+(?:[.,][0-9]+)?[ ]*(?:cm|inches|inch|in|ft)(?![A-Za-z])", re.IGNORECASE)  # "50 cm" (2mm kalınlık sayılmaz: mm yok)
_SEPARATORS = r"[•|–—:;,/-]"


def autofix_title(title: str, sizes_vary: bool, source_text: str | None) -> tuple[str, list[str]]:
    """Başlıktaki BARİZ ve güvenle düzeltilebilir hatalar sunucuda düzeltilir (modelin düzeltmesine bırakılırsa yapmıyordu; oturum 55): birden çok ölçü seçeneği varken ölçü, kaynakta olmayan özgül
    malzeme, 14 kelimeyi aşan kuyruk. Döner: (başlık, yapılanların listesi). Sonuç çok kısalırsa özgün başlık korunur (denetim yine uyarır)."""
    fixed, notes = title, []
    if sizes_vary and (_SIZE_TOKEN.search(fixed) or _SINGLE_SIZE.search(fixed)):
        fixed = _SINGLE_SIZE.sub(" ", _SIZE_TOKEN.sub(" ", fixed))
        notes.append(tr("başlıktaki ölçüler çıkarıldı (birden çok boyut seçeneği var)", "sizes removed from the title (the listing has several sizes)"))
    src = html.unescape(source_text or "").lower() + " " + " ".join(tr_material_words(source_text or ""))
    for w in sorted({w for w in _WORD.findall(fixed.lower()) if w in SPECIFIC_MATERIALS and not re.search(rf"\b{re.escape(w)}", src)}):
        fixed = re.sub(rf"\b{re.escape(w)}\b", " ", fixed, flags=re.IGNORECASE)
        notes.append(tr(f"söylenmeyen malzeme çıkarıldı ({w})", f"unstated material removed ({w})"))
    fixed = re.sub(rf"(?:[ ]*{_SEPARATORS}[ ]*){{2,}}", " – ", fixed)  # art arda kalan ayırıcılar
    fixed = re.sub(rf"^[ ]*{_SEPARATORS}[ ]*|[ ]*{_SEPARATORS}[ ]*$", "", " ".join(fixed.split())).strip()
    words = [w for w in re.split(r"[\s,|/–—-]+", fixed) if w]
    if len(words) > TITLE_MAX_WORDS:
        keep, count = [], 0
        for token in fixed.split():
            count += len([w for w in re.split(r"[,|/–—-]+", token) if w])
            if count > TITLE_MAX_WORDS:
                break
            keep.append(token)
        fixed = re.sub(rf"[ ]*{_SEPARATORS}[ ]*$", "", " ".join(keep)).strip()
        notes.append(tr(f"başlık {TITLE_MAX_WORDS} kelimeye kısaltıldı", f"title shortened to {TITLE_MAX_WORDS} words"))
    if not notes or len(fixed) < TITLE_MIN_CHARS:
        return title, []
    return fixed, notes


def brand_problems(title: str, tags: list[str], source_text: str | None = None) -> list[str]:
    src = html.unescape(source_text or "").lower()
    names = sorted({m.group(0).lower() for m in PROTECTED_NAMES.finditer(" ".join([title, *tags]))} - {m.group(0).lower() for m in PROTECTED_NAMES.finditer(src)})
    if not names:
        return []
    return [tr(
        f"Başlık/etiketlerde marka ya da karakter adı var ({', '.join(names)}); Etsy bunu telif/marka ihlali sayar. Genel bir ifade kullan (ör. süper kahraman, çizgi film karakteri yerine tarzı anlat).",
        f"The title/tags contain a brand or character name ({', '.join(names)}); Etsy treats this as infringement. Use a generic phrase (describe the style instead).",
    )]


def basic_problems(title: str, tags: list[str], product_description: str = "", source_text: str | None = None, sizes_vary: bool = True) -> list[str]:
    """Başlık/etiket/açıklama biçim kuralları (bkz. ai/standard.py); parçalar ayrı işlevlerdir, `audit` onları tek tek kullanır."""
    return title_problems(title, sizes_vary) + tag_problems(tags) + claim_problems(product_description, source_text) + brand_problems(title, tags, source_text)


def shop_others(db: Session, shop_id: int, exclude_id: int | None = None) -> list[dict]:
    """Mağazanın diğer listing'leri (yerel önbellekten): başlık, etiket, açıklama."""
    out = []
    for row in db.scalars(select(ListingCache).where(ListingCache.shop_id == shop_id)).all():
        if exclude_id is not None and row.listing_id == exclude_id:
            continue
        j = json.loads(row.raw_json)
        out.append({
            "listing_id": row.listing_id,
            "title": html.unescape(row.title or ""),
            "tags": [html.unescape(t) for t in (j.get("tags") or [])],
            "description": html.unescape(j.get("description") or ""),
        })
    return out


def similar_context(title: str, tags: list[str], others: list[dict], limit: int = 6) -> list[dict]:
    """Verilen metne en çok benzeyen diğer listing'ler (yapay zekâya "bunlarla aynı olma" bağlamı olarak verilir)."""
    tw, tg = _words(title), {t.lower() for t in tags}
    scored = []
    for o in others:
        score = _jaccard(tw, _words(o["title"])) + len(tg & {t.lower() for t in o["tags"]}) / TAG_COUNT
        if score > 0:
            scored.append((score, o))
    scored.sort(key=lambda x: -x[0])
    return [o for _, o in scored[:limit]]


def conflicts(title: str, tags: list[str], description: str, others: list[dict]) -> list[dict]:
    """Mağazadaki başka bir listing'le aynı aramalarda yarışma riski: listing başına bir kayıt (başlık benzerliği,
    ortak etiketler, açılış paragrafı benzerliği). Çakışma iki listing'in ortak durumudur; hangisinin düzenleneceği kullanıcıya kalır."""
    out: list[dict] = []
    tg = {t.lower() for t in tags}
    tw = _words(title)
    intro = _words(" ".join(description.split()[:60]))
    for o in others:
        shared = sorted(tg & {t.lower() for t in o["tags"]})
        sim = _jaccard(tw, _words(o["title"]))
        isim = _jaccard(intro, _words(" ".join(o["description"].split()[:60]))) if intro and len(intro) > 8 else 0.0
        c = {
            "listing_id": o.get("listing_id"),
            "title": o["title"],
            "title_similarity": round(sim * 100) if sim >= MAX_TITLE_SIMILARITY else None,
            "shared_tags": shared if len(shared) > MAX_SHARED_TAGS else [],
            "intro_similarity": round(isim * 100) if isim >= MAX_INTRO_SIMILARITY else None,
        }
        if c["title_similarity"] is not None or c["shared_tags"] or c["intro_similarity"] is not None:
            out.append(c)
    return out[:4]


def uniqueness_problems(title: str, tags: list[str], description: str, others: list[dict]) -> list[str]:
    """Başlık/etiket/açıklama açılışı, mağazadaki başka bir listing'in neredeyse kopyasıysa sorun döner (yapay zekâya geri bildirim)."""
    out: list[str] = []
    for c in conflicts(title, tags, description, others):
        name = c["title"][:60]
        if c["shared_tags"]:
            out.append(f'"{name}" listing\'iyle {len(c["shared_tags"])} etiket aynı ({", ".join(c["shared_tags"][:6])}…); en fazla {MAX_SHARED_TAGS} ortak olsun, kalanı bu ürüne özgü farklı uzun kuyruklu etiketlerle değiştir.')
        if c["title_similarity"] is not None:
            out.append(f'Başlık "{name}" listing\'ine çok benziyor (%{c["title_similarity"]}); ana arama öbeği kalabilir ama ikincil öbekleri bu ürüne özgü olanlarla (kişi/ad, kullanım yeri, stil, hediye vesilesi) değiştir.')
        if c["intro_similarity"] is not None:
            out.append(f'Açıklamanın ilk paragrafı "{name}" ile çok benziyor (%{c["intro_similarity"]}); bu ürüne özgü yeni bir giriş yaz.')
    return out[:6]


def strip_common_paragraphs(description: str, others: list[dict], min_count: int = 3) -> str:
    """Mağazanın en az `min_count` listing'inde aynen tekrar eden sabit bölümleri (teslimat, garanti, yasal uyarı…) çıkarır;
    kalite/benzersizlik denetimi yalnızca ürüne özel kısma bakar."""

    def norm(x: str) -> str:
        return re.sub(r"\s+", " ", x).strip().lower()

    counts: dict[str, int] = {}
    for o in others:
        for para in {norm(p) for p in re.split(r"\n\s*\n", o["description"]) if len(p.strip()) >= 25}:
            counts[para] = counts.get(para, 0) + 1
    kept = [p for p in re.split(r"\n\s*\n", description) if counts.get(norm(p), 0) < min_count]
    return "\n\n".join(kept)


def all_problems(
    title: str, tags: list[str], product_description: str, others: list[dict], source_text: str | None = None, sizes_vary: bool = True,
) -> list[str]:
    product_part = strip_common_paragraphs(product_description, others)
    return basic_problems(title, tags, product_part, source_text, sizes_vary) + uniqueness_problems(title, tags, product_part, others)

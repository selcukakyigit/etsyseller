"""Listing metni için ortak kalite ve benzersizlik denetimleri (AI önerisi ve sohbet asistanı aynı kuralları kullanır).

Amaç: aynı mağazadaki benzer ürünlerin (ör. 20 farklı çiftlik tabelası) başlık, etiket ve açıklamalarının birbirinin
kopyası olmaması; her listing kendi uzun kuyruklu anahtar kelimelerini hedeflesin, mağaza kendi kendisiyle rekabet etmesin."""
import html
import json
import re

from app.core.i18n import tr

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.listings.models import ListingCache

TAG_MAX_LEN = 20
MAX_SHARED_TAGS = 5  # başka tek bir listing'le en fazla bu kadar aynı etiket
MAX_TITLE_SIMILARITY = 0.6  # başlık kelime kümesi benzerliği (Jaccard)
MAX_INTRO_SIMILARITY = 0.6  # açıklamanın ilk ~60 kelimesinin benzerliği

_WORD = re.compile(r"[a-z0-9çğıöşü]+", re.I)
_STOP = {"the", "and", "for", "with", "your", "our", "you", "from", "this", "that", "a", "an", "of", "in", "to", "or", "by", "on", "at", "is", "it"}
RISKY_CLAIMS = re.compile(
    r"\b(hardware|mounting|included|provided|warranty|lifetime|waterproof|rust[- ]?proof|weather[- ]?proof|certified|fireproof|hypoallergenic)\b", re.I
)


def _words(text: str) -> set[str]:
    return {w for w in (m.lower() for m in _WORD.findall(text)) if w not in _STOP and len(w) > 1}


def _jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def clean_tags(tags: list[str]) -> list[str]:
    out, seen = [], set()
    for t in tags:
        t = " ".join(str(t).split())
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
TITLE_MAX_WORDS = 15
TITLE_MIN_CHARS = 20
_GIFT = re.compile(r"\b(gifts?|for (?:him|her|them|mom|mum|dad|men|women|kids|teens|wife|husband|boyfriend|girlfriend|grandma|grandpa|friends?))\b", re.I)
_SUBJECTIVE = re.compile(r"\b(beautiful|perfect|best|amazing|stunning|cute|lovely|unique|awesome|gorgeous|must[- ]have)\b", re.I)
_PROMO = re.compile(r"(free shipping|fast shipping|on sale|\bsale\b|discount|%\s*off|\boff\b\s*\d)", re.I)


def title_problems(title: str) -> list[str]:
    """Başlığın Etsy'nin güncel başlık rehberine uyumu."""
    out: list[str] = []
    words = [w for w in re.split(r"[\s,|/–—-]+", title.strip()) if w]
    if len(title) > 140:
        out.append(tr(f"Başlık {len(title)} karakter; en fazla 140 olabilir.", f"The title is {len(title)} characters; the limit is 140."))
    if len(words) > TITLE_MAX_WORDS:
        out.append(tr(
            f"Başlık {len(words)} kelime; Etsy 15 kelimeden kısa, net başlık öneriyor. Önce ürünün ne olduğunu, sonra renk/boyut/malzemeyi yaz; gerisini etiketlere ve açıklamaya taşı.",
            f"The title has {len(words)} words; Etsy recommends clear titles under 15 words. Say what the item is first, then color/size/material; move the rest to tags and the description.",
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
    if _SIZE.search(title):
        out.append(tr(
            "Başlıkta ölçü var; başlığa ölçü yazılmaz, ölçüler varyasyonlarda ve açıklamada.",
            "The title contains a size; sizes do not go in the title, they belong in the variations and description.",
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


def fact_problems(title: str, description: str, source_text: str, variations: dict[str, list[str]]) -> list[str]:
    """Önerinin listing'de olmayan bilgi uydurmadığını denetler: kaynakta geçmeyen ölçü ve renkler; birden çok seçeneği
    olan boyut/renk için başlıkta tek bir seçenek (alıcıyı yanıltır)."""
    out: list[str] = []
    src = html.unescape(source_text).lower()
    src_nums = {n.replace(",", ".") for n in _NUM.findall(src)}
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
        hits = [v for v in vals if v.lower() in t or any(n in _NUM.findall(t) for n in _NUM.findall(v))]
        if hits:
            out.append(tr(
                f"Başlıkta \"{name}\" seçeneklerinden yalnızca biri var ({hits[0]}), oysa {len(vals)} seçenek sunuluyor; başlığa tek bir seçeneği yazma.",
                f"The title names only one of the \"{name}\" options ({hits[0]}) although {len(vals)} are offered; do not put a single option in the title.",
            ))
    return out


def clean_title(title: str, variations: dict[str, list[str]]) -> str:
    """Model denemelere rağmen başlığa ölçü ya da birden çok seçeneği olan bir varyasyonun tek değerini yazdıysa onu
    başlıktan çıkarır; kalan noktalama toparlanır."""
    t = _SIZE.sub("", title)
    for vals in variations.values():
        if len(vals) < 2:
            continue
        for v in vals:
            word = re.sub(r"[^\w\s'&-]", "", v).strip()
            if word and not any(ch.isdigit() for ch in word):
                t = re.sub(rf"(?i)\b(?:in\s+)?{re.escape(word)}\b", "", t)
    t = re.sub(r"\s+,", ",", t)
    t = re.sub(r",\s*,+", ",", t)
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip(" ,-–|/")


def basic_problems(title: str, tags: list[str], product_description: str = "") -> list[str]:
    """Başlık/etiket/açıklama biçim kuralları."""
    out = title_problems(title)
    if len(tags) != 13:
        out.append(f"{len(tags)} etiket var; tam 13 olmalı.")
    long_tags = [t for t in tags if len(t) > TAG_MAX_LEN]
    if long_tags:
        out.append(f"Etiketler en fazla {TAG_MAX_LEN} karakter olabilir: {', '.join(long_tags)}.")
    single = [t for t in tags if " " not in t]
    if len(single) > 3:
        out.append(f"{len(single)} etiket tek kelime ({', '.join(single)}); 2–4 kelimelik uzun kuyruklu etiketler kullan.")
    claims = sorted({m.group(0).lower() for m in RISKY_CLAIMS.finditer(product_description)})
    if claims:
        out.append(f"Açıklamada doğrulanmamış iddialar var ({', '.join(claims)}); yalnızca kullanıcının verdiği ya da görselde görünen bilgiyi yaz.")
    return out


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
        score = _jaccard(tw, _words(o["title"])) + len(tg & {t.lower() for t in o["tags"]}) / 13
        if score > 0:
            scored.append((score, o))
    scored.sort(key=lambda x: -x[0])
    return [o for _, o in scored[:limit]]


def uniqueness_problems(title: str, tags: list[str], description: str, others: list[dict]) -> list[str]:
    """Başlık/etiket/açıklama açılışı, mağazadaki başka bir listing'in neredeyse kopyasıysa sorun döner."""
    out: list[str] = []
    tg = {t.lower() for t in tags}
    tw = _words(title)
    intro = _words(" ".join(description.split()[:60]))
    for o in others:
        shared = sorted(tg & {t.lower() for t in o["tags"]})
        if len(shared) > MAX_SHARED_TAGS:
            out.append(f'"{o["title"][:60]}" listing\'iyle {len(shared)} etiket aynı ({", ".join(shared[:6])}…); en fazla {MAX_SHARED_TAGS} ortak olsun, kalanı bu ürüne özgü farklı uzun kuyruklu etiketlerle değiştir.')
        sim = _jaccard(tw, _words(o["title"]))
        if sim >= MAX_TITLE_SIMILARITY:
            out.append(f'Başlık "{o["title"][:60]}" listing\'ine çok benziyor (%{round(sim * 100)}); ana anahtar öbeğini ve ikincil öbekleri farklılaştır.')
        if intro and len(intro) > 8:
            isim = _jaccard(intro, _words(" ".join(o["description"].split()[:60])))
            if isim >= MAX_INTRO_SIMILARITY:
                out.append(f'Açıklamanın ilk paragrafı "{o["title"][:60]}" ile çok benziyor (%{round(isim * 100)}); bu ürüne özgü yeni bir giriş yaz.')
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


def all_problems(title: str, tags: list[str], product_description: str, others: list[dict]) -> list[str]:
    product_part = strip_common_paragraphs(product_description, others)
    return basic_problems(title, tags, product_part) + uniqueness_problems(title, tags, product_part, others)

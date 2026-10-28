"""Taslak listing'in kalite puanı (0-10): kullanıcının söylediği her şey taslakta mı, başlık/etiket/açıklama kuralları, yayına hazırlık, Etsy sınırları ve harcanan tur.

Saf kural denetimidir (model çağrısı yok, ücretsiz): "5/10 mu 7/10 mu" tahminini ölçüme çevirir. Aynı işlev testlerde ve komut satırında kullanılır:
    python -m app.ai.listing_score 6        # son 6 yerel taslağı, sohbetteki kullanıcı metnine göre puanlar (tur sayısı sohbet kaydından)
Her ölçüt (ad, puan, bulgular) döner; bulgular neyin düşürdüğünü söyler. Puan yalnızca KESİN denetlenebilen şeyleri sayar; zevk/piyasa (hangi başlık daha çok satar) bunun dışındadır."""
import re

from app.ai import description_writer

WEIGHTS = {"sadakat": 0.25, "baslik": 0.15, "etiket": 0.10, "aciklama": 0.15, "tamlik": 0.20, "etsy_sinirlari": 0.05, "verimlilik": 0.10}
_PRICE = re.compile(r"(?:[$]\s*([0-9]+(?:[.,][0-9]+)?))|(?:([0-9]+(?:[.,][0-9]+)?)\s*(?:[$]|usd|dolar|dollars?))", re.IGNORECASE)
_DIMS = re.compile(r"([0-9]+(?:[.,][0-9]+)?)\s*(?:x|×|\*)\s*([0-9]+(?:[.,][0-9]+)?)", re.IGNORECASE)
_STOCK = re.compile(r"(?:toplam\s+stok|total\s+stock|stok\s+toplam)\D{0,12}([0-9]+)", re.IGNORECASE)
_COLORS = {"black": ("black", "siyah"), "white": ("white", "beyaz"), "gold": ("gold", "altın"), "grey": ("grey", "gray", "gri"), "brown": ("brown", "kahve"), "silver": ("silver", "gümüş"),
           "red": ("red", "kırmızı"), "blue": ("blue", "mavi"), "green": ("green", "yeşil")}
_TEXT_LINES = re.compile(r"([0-9]+)\s+(?:separate\s+)?(?:text\s+lines|personalization\s+boxes)", re.IGNORECASE)
_TRAILING = {"for", "with", "and", "of", "in", "the", "a", "to"}


def _num(text: str) -> float:
    return float(text.replace(",", "."))


def _offers(work: dict) -> list[dict]:
    return [o for p in (work.get("inventory") or {}).get("products", []) for o in p.get("offerings", [])]


def _prices(work: dict) -> list[float]:
    return [o["price"]["amount"] / o["price"]["divisor"] for o in _offers(work) if isinstance(o.get("price"), dict) and o["price"].get("divisor")]


def _option_labels(work: dict) -> list[str]:
    out: list[str] = []
    for p in (work.get("inventory") or {}).get("products", []):
        for pv in p.get("property_values", []):
            out += [str(v) for v in pv.get("values", [])]
    return list(dict.fromkeys(out))


def _grade(checks: list[tuple[bool, str]]) -> tuple[float, list[str]]:
    """(geçti mi, bulgu) listesinden 0-10 puan ve geçmeyenlerin bulguları."""
    if not checks:
        return 10.0, []
    failed = [msg for ok, msg in checks if not ok]
    return round(10 * (len(checks) - len(failed)) / len(checks), 1), failed


def fidelity(work: dict, said: str) -> tuple[float, list[str]]:
    """Kullanıcının yazdığı fiyat, ölçü, stok, renk ve kişiselleştirme taslakta var mı?"""
    checks: list[tuple[bool, str]] = []
    have = {round(p, 2) for p in _prices(work)}
    for m in _PRICE.finditer(said):
        value = round(_num(m.group(1) or m.group(2)), 2)
        checks.append((value in have, f"söylenen fiyat {value:g} taslakta yok"))
    labels = " ".join(_option_labels(work)).lower() + " " + str(work.get("description") or "").lower()
    for m in _DIMS.finditer(said):
        a, b = _num(m.group(1)), _num(m.group(2))
        checks.append((f"{a:g}" in labels and f"{b:g}" in labels, f"söylenen ölçü {a:g}x{b:g} etiket/açıklamada yok"))
    stock = _STOCK.search(said)
    if stock:
        n = int(stock.group(1))
        quantities = {o.get("quantity") for o in _offers(work)}
        shared = (work.get("inventory") or {}).get("quantity_on_property") == []
        checks.append((quantities == {n} and shared, f"'toplam stok {n}' tek havuz olmalı (bulunan: {sorted(q for q in quantities if q is not None)}, havuz={shared})"))
    low_said, low_labels = said.lower(), " ".join(_option_labels(work)).lower()
    for en, words in _COLORS.items():
        if any(re.search(rf"(?<![a-zçğıöşü]){w}(?![a-zçğıöşü])", low_said) for w in words):
            checks.append((en in low_labels, f"söylenen renk {en} seçeneklerde yok"))
    if re.search(r"kişiselleştir|personali[sz]", low_said):
        checks.append((bool((work.get("personalization") or {}).get("questions")), "kişiselleştirme söylendi ama alan yok"))
    return _grade(checks)


def title(work: dict) -> tuple[float, list[str]]:
    t = str(work.get("title") or "")
    words = re.findall(r"[a-z0-9']+", t.lower())
    mats = {w.lower() for m in work.get("materials") or [] for w in re.findall(r"[A-Za-z]+", str(m))}
    tag_words = {w for tag in (work.get("tags") or [])[:5] for w in re.findall(r"[a-z]+", tag.lower())}
    return _grade([
        (0 < len(t) <= 140, f"başlık uzunluğu {len(t)} (en çok 140)"),
        (not mats or bool(mats & set(words)), f"başlıkta malzeme yok ({', '.join(sorted(mats))})"),
        (len(set(words) & tag_words) >= 2, "başlık ilk etiketlerle neredeyse hiç örtüşmüyor"),
        (not re.search(r"[0-9]+\s*(?:x|×)\s*[0-9]+|\b[0-9]+\s*(?:cm|mm|inch|in)\b", t.lower()), "başlıkta ölçü var"),
        (len(words) == len(set(words)) or len(words) - len(set(words)) <= 1, "başlıkta tekrar eden kelime var"),
        (len(words) <= 18, f"başlık {len(words)} kelime (fazla uzun)"),
    ])


def tags(work: dict) -> tuple[float, list[str]]:
    items = [str(x) for x in work.get("tags") or []]
    low = [x.lower() for x in items]
    return _grade([
        (len(items) == 13, f"{len(items)} etiket (13 olmalı)"),
        (all(len(x) <= 20 for x in items), "20 karakteri aşan etiket var"),
        (len(set(low)) == len(low), "tekrar eden etiket var"),
        (not any(re.search(r"\bsize\b|[0-9]+\s*x\s*[0-9]+", x) for x in low), "ölçü/'size' içeren etiket (arama değeri düşük): " + ", ".join(x for x in low if re.search(r"\bsize\b|[0-9]+\s*x\s*[0-9]+", x))),
        (not any(x.split()[-1] in _TRAILING for x in low if x.split()), "yarım kalmış etiket (edat ile bitiyor)"),
    ])


def description(work: dict) -> tuple[float, list[str]]:
    d = str(work.get("description") or "")
    intro = d.split("DETAILS")[0]
    n_words = len(re.findall(r"\w+", intro))
    text_fields = [q for q in (work.get("personalization") or {}).get("questions", []) if q.get("question_type") == "text_input"]
    claimed = [int(n) for n in _TEXT_LINES.findall(d)]
    labels_missing = [o for o in _option_labels(work) if len(o) > 2 and o.lower() not in d.lower()]
    return _grade([
        (60 <= n_words <= 220, f"giriş {n_words} kelime (60-220 beklenir)"),
        ("DETAILS" in d, "DETAILS bölümü yok"),
        ("$" not in intro, "giriş metninde fiyat var"),
        (not description_writer._BANNED.search(intro), "girişte yasak/abartı sözcük var"),
        (not claimed or all(n == len(text_fields) for n in claimed), f"açıklama {claimed} metin kutusu diyor, taslakta {len(text_fields)} metin alanı var"),
        (not _option_labels(work) or len(labels_missing) <= len(_option_labels(work)) // 2, "seçeneklerin çoğu açıklamada geçmiyor"),
    ])


def completeness(work: dict) -> tuple[float, list[str]]:
    prices = _prices(work)
    return _grade([
        (bool(prices) and all(p > 0 for p in prices), "fiyat yok"),
        (bool(work.get("images")), "resim yok"),
        (bool(work.get("taxonomy_id")), "kategori yok"),
        (bool(work.get("shipping_profile_id")) and bool(work.get("return_policy_id")), "kargo/iade profili yok"),
        (len(work.get("properties") or []) >= 3, "kategori özellikleri az (3'ten az)"),
        (bool(work.get("who_made")) and bool(work.get("when_made")), "kim/ne zaman yaptı yok"),
    ])


def etsy_limits(work: dict) -> tuple[float, list[str]]:
    long_options = [o for o in _option_labels(work) if len(o) > 20]
    return _grade([
        (not long_options, f"20 karakteri aşan seçenek adı: {long_options[:3]}"),
        (len(str(work.get("title") or "")) <= 140, "başlık 140 karakteri aşıyor"),
        (all(len(str(t)) <= 20 for t in work.get("tags") or []), "20 karakteri aşan etiket"),
        (len(work.get("materials") or []) <= 13, "13'ten fazla malzeme"),
    ])


def efficiency(rounds: int | None) -> tuple[float, list[str]]:
    """Model turu: 4 ve altı tam puan, her ek tur 0,7 düşürür."""
    if rounds is None:
        return 10.0, ["tur sayısı bilinmiyor (sayılmadı)"]
    return round(max(0.0, min(10.0, 10 - (rounds - 4) * 0.7)), 1), ([f"{rounds} tur (hedef ≤4)"] if rounds > 4 else [])


def score(work: dict, said: str, rounds: int | None = None) -> dict:
    """{"toplam": 0-10, "olcutler": {ad: {"puan", "bulgular"}}}: ağırlıklı ortalama."""
    parts = {
        "sadakat": fidelity(work, said), "baslik": title(work), "etiket": tags(work), "aciklama": description(work),
        "tamlik": completeness(work), "etsy_sinirlari": etsy_limits(work), "verimlilik": efficiency(rounds),
    }
    total = sum(WEIGHTS[k] * v[0] for k, v in parts.items())
    critical = [m for m in parts["sadakat"][1] + parts["tamlik"][1] if "fiyat" in m or "stok" in m]
    if critical:
        total = min(total, 6.0)  # yayına çıkamayan ya da söylenen fiyat/stoğu kaybeden taslak 6'nın üstüne çıkamaz
    return {"toplam": round(total, 1), "kritik": critical, "olcutler": {k: {"puan": v[0], "bulgular": v[1]} for k, v in parts.items()}}


def _main(count: int) -> None:  # pragma: no cover - elle çalıştırılan rapor
    import json

    from sqlalchemy import text

    from app.core.db import SessionLocal

    db = SessionLocal()
    for rid, lid, ts in db.execute(text("select id, listing_id, updated_at from listing_locals where listing_id < 0 order by updated_at desc limit :n"), {"n": count}).all():
        work = json.loads(db.execute(text("select data_json from listing_locals where id=:i"), {"i": rid}).scalar())
        sid = db.execute(text("select session_id from chat_messages where role='assistant' and created_at >= :t order by created_at limit 1"), {"t": ts}).scalar()
        said = "\n".join(r[0] or "" for r in db.execute(text("select content from chat_messages where session_id=:s and role='user' order by id"), {"s": sid}).all()) if sid else ""
        rounds = db.execute(text("select sum(rounds) from assistant_usage where session_id=:s"), {"s": sid}).scalar() if sid else None
        result = score(work, said, int(rounds) if rounds else None)
        print(f"\n#{lid} oturum={sid} turn={rounds}  TOPLAM {result['toplam']}/10  {str(work.get('title'))[:60]}")
        for name, v in result["olcutler"].items():
            print(f"   {name:15} {v['puan']:>4}  " + "; ".join(v["bulgular"])[:230])


if __name__ == "__main__":  # pragma: no cover
    import sys

    _main(int(sys.argv[1]) if len(sys.argv) > 1 else 5)

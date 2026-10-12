"""Tedarikçi belgesi profili (Analyzer). Üretim raporu, fatura, irsaliye, fiş, teklif ya da el yazısı not olabilir.

Çıktı, sektörden bağımsız tek bir şekildir:
    measures — ölçülen değerler (süre, uzunluk, adet, ağırlık…): fiyat listesindeki bir kaleme eşlenip miktar olur
    lines    — ücretlendirilmiş kalemler (açıklama, miktar, birim fiyat, tutar)
    net / vat / total — belgedeki toplamlar (KDV hariç / KDV / genel toplam)
    info     — sayısal olmayan bilgiler (plaka ölçüsü, dosya adı…)

Makine çıktısı raporlar ("Etiket: değer" düzeninde, ör. lazer kesim yazılımının Production Report'u) yapay zekâsız,
kural tabanlı okunur. Para içeren belgeler (fatura, fiş) her zaman yapay zekâya gider: satırlar ve toplamlar gerekir."""
import datetime as dt
import re

from app.modkit import analyzer, units
from app.modkit.numbers import parse_amount, parse_duration, parse_measure, slug

KEY = "supply_document"

PROMPT = (
    "Bu bir tedarikçi belgesi: üretim raporu, fatura, irsaliye, fiş, teklif ya da el yazısı not olabilir. "
    "Belgeden yalnızca şu JSON'u çıkar, başka hiçbir metin ekleme:\n"
    '{"doc_type": "report" | "invoice" | "receipt" | "quote" | "note" | "other", "doc_number": "belge no ya da null", '
    '"date": "YYYY-MM-DD ya da null", "vendor": "düzenleyen firma ya da null", "currency": "para birimi kodu (TL için TRY) ya da null", '
    '"measures": [{"label": "alanın belgede yazdığı adı", "text": "değer belgede yazdığı gibi", '
    '"unit": "s|min|h|g|kg|t|mm|cm|m|cm2|m2|ml|l|m3|piece|sheet ya da null"}], '
    '"lines": [{"description": "kalemin adı (ölçü/malzeme dahil, ör. 1500x3000 2 mm siyah sac)", "qty_text": "miktar ya da null", '
    '"unit": "piece|sheet|kg|m|m2|h|min|... ya da null", "unit_price_text": "birim fiyat yazdığı gibi ya da null", '
    '"amount_text": "satır tutarı yazdığı gibi"}], '
    '"net_text": "KDV hariç toplam yazdığı gibi ya da null", "vat_text": "KDV tutarı ya da null", '
    '"total_text": "genel toplam ya da null", "vat_rate": KDV yüzdesi sayı ya da null, '
    '"info": [{"label": "...", "text": "..."}]}\n'
    "KURALLAR: (1) measures: ölçülen/planlanan değerler (süre, kesim uzunluğu, delik/pierce sayısı, ağırlık, alan, adet). "
    "Para tutarı measures'a YAZILMAZ. (2) lines: ücretlendirilen her kalem ayrı; toplam/KDV satırları lines'a YAZILMAZ. "
    "(3) Tutarları ve süreleri belgede yazdığı gibi AYNEN kopyala (ör. '4.500', '8 673', '25min4,8s'); ayraçları değiştirme. "
    "(4) Belgedeki EL YAZISINI yok say, yalnızca basılı/dijital metni oku; kullanıcının yazdığı not metninde 'X TL + KDV' gibi ifade varsa net_text = X. (5) Ölçü/plaka boyutu gibi sayısal olmayan bilgiler info'ya. "
    "(6) Emin olmadığını null bırak, uydurma."
)

_MONEY_HINT = re.compile(r"(₺|€|\$|£|\bTL\b|\bTRY\b|\bUSD\b|\bEUR\b|\bGBP\b|\bkdv\b|\bvat\b|\btoplam\b|\btutar\b|\bamount\b|\bsubtotal\b|\binvoice\b|\bfatura\b|\bfiyat\b|\bprice\b)", re.I)
_PAIR = re.compile(r"(?m)([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü ./()#-]{1,48}?)\s*:\s*([^\n:]{1,60}?)(?=\s{2,}|\s+[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü ./()#-]{1,48}?\s*:|\n|$)")
_DIMS = re.compile(r"\d\s*[x×*]\s*\d")
_DATE_YMD = re.compile(r"\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b")
_DATE_DMY = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b")
_LEN_UNIT = re.compile(r"(?<![a-z])(mm|cm|m)\s*$", re.I)
_COUNT_WORDS = ("count", "adet", "sayı", "sayi", "number", "qty", "quantity", "pierce", "delik", "parça", "parca", "pieces", "parts")


def _date(text: str) -> str | None:
    for rx, order in ((_DATE_YMD, "ymd"), (_DATE_DMY, "dmy")):
        m = rx.search(text or "")
        if m:
            a, b, c = (int(x) for x in m.groups())
            y, mo, d = (a, b, c) if order == "ymd" else (c, b, a)
            try:
                return dt.date(y, mo, d).isoformat()
            except ValueError:
                continue
    return None


def _measure(label: str, text: str, unit_hint: str | None = None) -> dict | None:
    """Etiket + değer metninden ölçü. Süre → saniye; "mm/cm/m" ekli → o birim; sayaç etiketi → adet."""
    text = (text or "").strip()
    if not text or _DIMS.search(text):
        return None
    secs = parse_duration(text)
    if secs is not None:
        return {"key": slug(label), "label": label.strip(), "text": text, "value": round(secs, 3), "unit": "s"}
    value = parse_measure(text)
    if value is None:
        return None
    m = _LEN_UNIT.search(text)
    if m:
        unit = m.group(1).lower()
    elif unit_hint in units.UNITS:
        unit = unit_hint
    elif any(w in label.lower() for w in _COUNT_WORDS) and float(value).is_integer():
        unit = "piece"
    else:
        return None
    return {"key": slug(label), "label": label.strip(), "text": text, "value": value, "unit": unit}


def parse_report_text(text: str) -> dict | None:
    """Makine çıktısı rapor: "Etiket: değer" çiftleri. Para geçen belgelerde None (yapay zekâ satır/toplam okur)."""
    if not text or _MONEY_HINT.search(text):
        return None
    measures, info, seen = [], [], set()
    for label, value in _PAIR.findall(text):
        label, value = label.strip(), value.strip()
        key = slug(label)
        if not key or key in seen:
            continue
        seen.add(key)
        m = _measure(label, value)
        if m is not None:
            measures.append(m)
        elif value:
            info.append({"label": label, "text": value})
    if len(measures) < 2:
        return None
    return {"doc_type": "report", "doc_number": None, "date": _date(text), "vendor": None, "currency": None,
            "measures": measures, "lines": [], "net": None, "vat": None, "total": None, "vat_rate": None, "info": info[:20]}


def normalize(raw: dict) -> dict:
    """Yapay zekâ çıktısını (metin olarak kopyalanmış değerler) sayılara çevirir; kural okuyucunun çıktısı zaten normaldir."""
    if raw.get("_normalized"):
        return raw
    measures = []
    for m in raw.get("measures") or []:
        if not isinstance(m, dict):
            continue
        got = _measure(str(m.get("label") or ""), str(m.get("text") or m.get("value") or ""), (m.get("unit") or None))
        if got is not None and got["key"]:
            measures.append(got)
    lines = []
    for ln in raw.get("lines") or []:
        if not isinstance(ln, dict):
            continue
        desc = str(ln.get("description") or "").strip()[:200]
        amount = parse_amount(ln.get("amount_text") if ln.get("amount_text") not in (None, "") else ln.get("amount"))[0]
        qty = parse_measure(ln.get("qty_text") if ln.get("qty_text") not in (None, "") else ln.get("qty"))
        unit_price = parse_amount(ln.get("unit_price_text") if ln.get("unit_price_text") not in (None, "") else ln.get("unit_price"))[0]
        unit = ln.get("unit") if ln.get("unit") in units.UNITS else None
        if not desc or (amount is None and unit_price is None):
            continue
        if amount is None and unit_price is not None:
            amount = round(unit_price * (qty or 1), 2)
        lines.append({"key": "line:" + slug(desc), "description": desc, "qty": qty, "unit": unit, "unit_price": unit_price, "amount": amount})
    net = parse_amount(raw.get("net_text") or raw.get("net"))[0]
    vat = parse_amount(raw.get("vat_text") or raw.get("vat"))[0]
    total = parse_amount(raw.get("total_text") or raw.get("total"))[0]
    if net is None and lines and total is None:
        net = round(sum(x["amount"] or 0 for x in lines), 2)
    vat_rate = raw.get("vat_rate")
    vat_rate = float(vat_rate) if isinstance(vat_rate, (int, float)) and 0 <= vat_rate <= 100 else None
    if net is None and total is not None and vat is not None:
        net = round(total - vat, 2)
    currency = str(raw.get("currency") or "").upper()[:3] or None
    info = [{"label": str(i.get("label") or "")[:80], "text": str(i.get("text") or "")[:200]} for i in (raw.get("info") or []) if isinstance(i, dict)]
    date = raw.get("date")
    try:
        date = dt.date.fromisoformat(str(date)).isoformat() if date else None
    except ValueError:
        date = None
    return {
        "_normalized": True, "doc_type": raw.get("doc_type") or "other", "doc_number": (str(raw.get("doc_number") or "")[:60] or None),
        "date": date, "vendor": (str(raw.get("vendor") or "")[:120] or None), "currency": currency,
        "measures": measures, "lines": lines, "net": net, "vat": vat, "total": total, "vat_rate": vat_rate, "info": info[:30],
    }


def merge_note(data: dict | None, note_data: dict | None, note: str) -> dict:
    """Kullanıcının yükleme notundan okunanı (normalize edilmiş) belgeden okunanla birleştirir. Belgede olan değer korunur, not
    yalnızca eksikleri doldurur; notun kendisi "Not" bilgisi olarak görünür kalır ki yorum kullanıcı gözünden geçsin."""
    base = dict(data) if data else normalize({})
    extra = note_data or {}
    for k in ("net", "vat", "total", "vat_rate", "currency", "date"):
        if base.get(k) is None and extra.get(k) is not None:
            base[k] = extra[k]
    have = {m["key"] for m in base["measures"]}
    base["measures"] = base["measures"] + [m for m in extra.get("measures", []) if m["key"] not in have]
    base["lines"] = base["lines"] + extra.get("lines", [])
    base["info"] = (base["info"] + [{"label": "Not", "text": note[:200]}])[:30]
    return base


def _parse_text(text: str) -> dict | None:
    got = parse_report_text(text)
    return {**got, "_normalized": True} if got else None


def _usable(data: dict) -> bool:
    d = normalize(data)
    return bool(d["measures"] or d["lines"] or d["net"] is not None or d["total"] is not None)


PROFILE = analyzer.register(analyzer.Profile(key=KEY, prompt=PROMPT, parse_text=_parse_text, usable=_usable, max_tokens=3000, ocr=True))
